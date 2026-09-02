import "server-only";

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { PAY_METHODS, type PayMethodKey } from "@/lib/membership";
import {
  MEMBERSHIP_PRODUCT_TYPE,
  isValidOrderProductTarget,
  type OrderProductType,
} from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";
import {
  assertQianheConfiguration,
  createQianheOrder,
  PaymentProviderError,
  paymentSiteOrigin,
  type CreatedQianheOrder,
} from "@/lib/qianhe-payment";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";

export type PaymentStartErrorCode =
  | PaymentProviderError["code"]
  | "rate";

type StartPaymentOrderInput = {
  userId: number;
  siteId: string;
  productType: OrderProductType;
  alleyPostId: number | null;
  teacherPostId: number | null;
  plan: string;
  subject: string;
  amount: number;
  payMethod: PayMethodKey;
};

type StartPaymentOrderResult =
  | { ok: true; paymentUrl: string }
  | { ok: false; code: PaymentStartErrorCode };

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
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function selectedPayMethod(
  value: FormDataEntryValue | null,
): PayMethodKey | null {
  const key = String(value ?? "");
  return PAY_METHODS.find((method) => method.key === key)?.key ?? null;
}

export async function startPaymentOrder(
  input: StartPaymentOrderInput,
): Promise<StartPaymentOrderResult> {
  const site = await getCurrentSite();
  const expectedAmount =
    input.productType === MEMBERSHIP_PRODUCT_TYPE
      ? site.membershipPrice
      : site.singlePostPrice;
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.siteId !== site.id ||
    Math.round(input.amount * 100) !== Math.round(expectedAmount * 100) ||
    !isValidOrderProductTarget(
      input.productType,
      input.alleyPostId,
      input.teacherPostId,
    ) ||
    !input.plan ||
    !input.subject
  ) {
    throw new Error("Invalid payment product");
  }

  try {
    assertQianheConfiguration(input.payMethod, siteOrigin(site));
  } catch {
    return { ok: false, code: "configuration" };
  }

  const existing = await prisma.order.findFirst({
    where: {
      userId: input.userId,
      siteId: site.id,
      productType: input.productType,
      alleyPostId: input.alleyPostId,
      teacherPostId: input.teacherPostId,
      payMethod: input.payMethod,
      status: "pending",
      paymentUrl: { not: null },
      paymentExpiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { paymentUrl: true },
  });
  const existingPaymentUrl = safeStoredPaymentUrl(existing?.paymentUrl ?? null);
  if (existingPaymentUrl) return { ok: true, paymentUrl: existingPaymentUrl };

  const recentOrderCount = await prisma.order.count({
    where: {
      userId: input.userId,
      siteId: site.id,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (recentOrderCount >= 3) return { ok: false, code: "rate" };

  const merchantOrderNo = merchantOrderNumber();
  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      siteId: site.id,
      plan: input.plan,
      amount: input.amount,
      productType: input.productType,
      alleyPostId: input.alleyPostId,
      teacherPostId: input.teacherPostId,
      payMethod: input.payMethod,
      status: "pending",
      merchantOrderNo,
    },
  });

  const checkoutOrigin = paymentSiteOrigin(siteOrigin(site));
  const requestHeaders = await headers();
  let providerOrder: CreatedQianheOrder | null = null;
  let providerError: PaymentProviderError["code"] = "unavailable";
  try {
    providerOrder = await createQianheOrder({
      payMethod: input.payMethod,
      merchantOrderNo,
      subject: input.subject,
      amountCents: Math.round(input.amount * 100),
      clientIp: requestClientIp(requestHeaders),
      notifyUrl: new URL("/api/payments/qianhe/notify", checkoutOrigin).toString(),
      returnUrl: new URL(`/vip/pay/${order.id}`, checkoutOrigin).toString(),
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) providerError = error.code;
  }

  if (!providerOrder) {
    console.error(`[payment] create order failed: ${providerError}`);
    return { ok: false, code: providerError };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      providerTradeNo: providerOrder.tradeNo,
      paymentUrl: providerOrder.paymentUrl,
      paymentExpiresAt: providerOrder.expiresAt,
    },
  });

  return { ok: true, paymentUrl: providerOrder.paymentUrl };
}
