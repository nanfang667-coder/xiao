import "server-only";

import { prisma } from "@/lib/prisma";
import { COMMISSION_RATE } from "@/lib/membership";

export type FulfillOrderResult =
  | "paid"
  | "already_paid"
  | "not_found"
  | "amount_mismatch"
  | "invalid_status";

type FulfillOrderInput = {
  orderId: number;
  paidAmountCents: number;
  providerTradeNo: string;
  paidAt?: Date;
};

function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

// 仅供已经完成“支付平台回调验签”的服务端代码调用。
// 在一个事务中认领订单、开通会员并生成佣金，确保重复回调不会重复入账。
export async function fulfillPaidOrder({
  orderId,
  paidAmountCents,
  providerTradeNo,
  paidAt = new Date(),
}: FulfillOrderInput): Promise<FulfillOrderResult> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return "not_found";
  if (!Number.isSafeInteger(paidAmountCents) || paidAmountCents < 0) {
    return "amount_mismatch";
  }
  if (!providerTradeNo || providerTradeNo.length > 255) return "invalid_status";

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        amount: true,
        status: true,
        providerTradeNo: true,
      },
    });

    if (!order) return "not_found";
    if (amountToCents(order.amount) !== paidAmountCents) return "amount_mismatch";
    if (order.providerTradeNo && order.providerTradeNo !== providerTradeNo) {
      return "invalid_status";
    }
    if (order.status === "paid") return "already_paid";
    if (order.status !== "pending" && order.status !== "failed") return "invalid_status";

    // 只有第一个回调能把 pending 改为 paid；并发或重复回调不会重复发放权益。
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["pending", "failed"] } },
      data: { status: "paid", paidAt, providerTradeNo },
    });
    if (claimed.count !== 1) return "invalid_status";

    const buyer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { referredBy: true },
    });
    if (!buyer) throw new Error("Payment order user does not exist");

    // 即使用户同时创建了多笔订单，也只有第一笔成功订单能把非会员改成会员。
    const activated = await tx.user.updateMany({
      where: { id: order.userId, isMember: false },
      data: {
        isMember: true,
        membershipExpiresAt: null,
        memberSince: paidAt,
      },
    });

    // 已是会员时仍保持永久会员状态，但不会重复发放“新会员”佣金。
    if (activated.count === 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: { membershipExpiresAt: null },
      });
    }

    if (buyer.referredBy && activated.count === 1) {
      await tx.commission.upsert({
        where: { orderId: order.id },
        create: {
          referrerId: buyer.referredBy,
          orderId: order.id,
          amount: order.amount * COMMISSION_RATE,
        },
        update: {},
      });
    }

    return "paid";
  });
}
