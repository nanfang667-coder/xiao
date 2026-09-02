"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { isActiveMember, MEMBERSHIP_PLAN } from "@/lib/membership";
import {
  selectedPayMethod,
  startPaymentOrder,
} from "@/lib/payment-order";
import {
  MEMBERSHIP_PRODUCT_TYPE,
  paidOrderDestination,
} from "@/lib/payment-products";
import { fulfillPaidOrder } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { queryQianheOrder } from "@/lib/qianhe-payment";
import { requireUser } from "@/lib/user-auth";

export async function createOrder(formData: FormData) {
  if (!PAYMENT_FEATURE_ENABLED) redirect("/");

  const user = await requireUser();
  if (isActiveMember(user)) redirect("/vip");

  const payMethod = selectedPayMethod(formData.get("payMethod"));
  if (!payMethod) throw new Error("不支持的支付方式");

  const result = await startPaymentOrder({
    userId: user.id,
    productType: MEMBERSHIP_PRODUCT_TYPE,
    alleyPostId: null,
    teacherPostId: null,
    plan: MEMBERSHIP_PLAN.name,
    subject: MEMBERSHIP_PLAN.name,
    amount: MEMBERSHIP_PLAN.price,
    payMethod,
  });
  if (!result.ok) redirect(`/vip?paymentError=${result.code}`);
  redirect(result.paymentUrl);
}

// 回调遗漏时的安全补偿：主动查单，只有平台签名响应明确为支付成功才入账。
export async function refreshPaymentStatus(orderId: number) {
  if (!PAYMENT_FEATURE_ENABLED) redirect("/");

  const user = await requireUser();
  if (!Number.isSafeInteger(orderId) || orderId <= 0) redirect("/vip");

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: {
      id: true,
      amount: true,
      status: true,
      merchantOrderNo: true,
      productType: true,
      alleyPostId: true,
      teacherPostId: true,
    },
  });
  if (!order) redirect("/vip");

  const successDestination = paidOrderDestination(
    order.productType,
    order.alleyPostId,
    order.teacherPostId,
  );
  if (!successDestination) redirect("/vip");
  if (order.status === "paid") redirect(successDestination);
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
      if (order.alleyPostId) revalidatePath(`/alley/${order.alleyPostId}`);
      if (order.teacherPostId) revalidatePath(`/listing/${order.teacherPostId}`);
      redirect(successDestination);
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
