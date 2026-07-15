"use server"; // 服务器操作：创建订单、向已验签的支付平台查单

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/user-auth";
import {
  isActiveMember,
  MEMBERSHIP_PLAN,
  PAY_METHODS,
  type PayMethodKey,
} from "@/lib/membership";
import { fulfillPaidOrder } from "@/lib/payment";
import {
  assertQianheConfiguration,
  createQianheOrder,
  PaymentProviderError,
  paymentSiteOrigin,
  queryQianheOrder,
  type CreatedQianheOrder,
} from "@/lib/qianhe-payment";

function merchantOrderNumber(): string {
  return `GP77${Date.now().toString(36)}${randomBytes(6).toString("hex")}`.toUpperCase();
}

function requestClientIp(requestHeaders: Headers): string {
  const candidates = [
    ...(requestHeaders.get("x-forwarded-for")?.split(",") ?? []),
    requestHeaders.get("x-real-ip"),
  ];
  for (const value of candidates) {
    const candidate = value?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return "0.0.0.0";
}

function safeStoredPaymentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function selectedPayMethod(value: FormDataEntryValue | null): PayMethodKey | null {
  const key = String(value ?? "");
  return PAY_METHODS.find((method) => method.key === key)?.key ?? null;
}

// 创建本站订单并请求支付平台下单。商户密钥仅在服务端参与签名。
export async function createOrder(formData: FormData) {
  const user = await requireUser();
  if (isActiveMember(user)) redirect("/vip");

  const payMethod = selectedPayMethod(formData.get("payMethod"));
  if (!payMethod) throw new Error("不支持的支付方式");

  let paymentConfigured = true;
  try {
    assertQianheConfiguration(payMethod);
  } catch {
    paymentConfigured = false;
  }
  if (!paymentConfigured) redirect("/vip?paymentError=configuration");

  // 防止连续点击产生多笔可支付订单；已有未过期收银台时直接复用。
  const existing = await prisma.order.findFirst({
    where: {
      userId: user.id,
      payMethod,
      status: "pending",
      paymentUrl: { not: null },
      paymentExpiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { paymentUrl: true },
  });
  const existingPaymentUrl = safeStoredPaymentUrl(existing?.paymentUrl ?? null);
  if (existingPaymentUrl) redirect(existingPaymentUrl);

  const recentOrderCount = await prisma.order.count({
    where: {
      userId: user.id,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (recentOrderCount >= 3) redirect("/vip?paymentError=rate");

  const merchantOrderNo = merchantOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      plan: MEMBERSHIP_PLAN.name,
      amount: MEMBERSHIP_PLAN.price,
      payMethod,
      status: "pending",
      merchantOrderNo,
    },
  });

  const siteOrigin = paymentSiteOrigin();
  const requestHeaders = await headers();
  let providerOrder: CreatedQianheOrder | null = null;
  let providerError: PaymentProviderError["code"] = "unavailable";
  try {
    providerOrder = await createQianheOrder({
      payMethod,
      merchantOrderNo,
      subject: MEMBERSHIP_PLAN.name,
      amountCents: Math.round(MEMBERSHIP_PLAN.price * 100),
      clientIp: requestClientIp(requestHeaders),
      notifyUrl: new URL("/api/payments/qianhe/notify", siteOrigin).toString(),
      returnUrl: new URL(`/vip/pay/${order.id}`, siteOrigin).toString(),
    });
  } catch (error) {
    // 超时并不代表平台一定没有创建订单，保持待支付以便稍后的签名回调能够补入账。
    if (error instanceof PaymentProviderError) providerError = error.code;
  }

  if (!providerOrder) redirect(`/vip?paymentError=${providerError}`);

  await prisma.order.update({
    where: { id: order.id },
    data: {
      providerTradeNo: providerOrder.tradeNo,
      paymentUrl: providerOrder.paymentUrl,
      paymentExpiresAt: providerOrder.expiresAt,
    },
  });

  redirect(providerOrder.paymentUrl);
}

// 回调遗漏时的安全补偿：主动查单，只有平台签名响应明确为支付成功才入账。
export async function refreshPaymentStatus(orderId: number) {
  const user = await requireUser();
  if (!Number.isSafeInteger(orderId) || orderId <= 0) redirect("/vip");

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: {
      id: true,
      amount: true,
      status: true,
      merchantOrderNo: true,
    },
  });
  if (!order) redirect("/vip");
  if (order.status === "paid") redirect("/vip?paid=1");
  if (!order.merchantOrderNo) redirect(`/vip/pay/${order.id}?check=failed`);

  const checkClaimed = await prisma.order.updateMany({
    where: {
      id: order.id,
      userId: user.id,
      OR: [
        { paymentCheckedAt: null },
        { paymentCheckedAt: { lte: new Date(Date.now() - 5_000) } },
      ],
    },
    data: { paymentCheckedAt: new Date() },
  });
  if (checkClaimed.count !== 1) redirect(`/vip/pay/${order.id}?check=pending`);

  const amountCents = Math.round(order.amount * 100);
  let queried: Awaited<ReturnType<typeof queryQianheOrder>> | null = null;
  try {
    queried = await queryQianheOrder(order.merchantOrderNo, amountCents);
  } catch {
    // 不信任无法验签或无法确认的结果，保持本地订单原状态。
  }

  if (!queried) redirect(`/vip/pay/${order.id}?check=failed`);

  if (queried.state === 2) {
    const result = await fulfillPaidOrder({
      orderId: order.id,
      paidAmountCents: amountCents,
      providerTradeNo: queried.tradeNo,
      paidAt: queried.paidAt,
    });
    if (result === "paid" || result === "already_paid") {
      revalidatePath("/");
      revalidatePath("/vip");
      redirect("/vip?paid=1");
    }
    redirect(`/vip/pay/${order.id}?check=failed`);
  }

  if (queried.state === 3 || queried.state === 4) {
    await prisma.order.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: queried.state === 3 ? "failed" : "reversed" },
    });
  }

  redirect(`/vip/pay/${order.id}?check=pending`);
}
