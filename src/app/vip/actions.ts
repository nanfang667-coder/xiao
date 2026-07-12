"use server"; // 服务器操作：下单、确认支付

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, refreshSession } from "@/lib/user-auth";
import { MEMBERSHIP_PLAN, COMMISSION_RATE } from "@/lib/membership";

// 创建订单：用户在 VIP 页选好支付方式点「立即开通」时调用。
// 生成一笔待支付订单后，跳转到支付页。
export async function createOrder(formData: FormData) {
  const user = await requireUser(); // 未登录会自动跳去登录页
  const payMethod = String(formData.get("payMethod") ?? "wechat");

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      plan: MEMBERSHIP_PLAN.name,
      amount: MEMBERSHIP_PLAN.price,
      payMethod,
      status: "pending",
    },
  });

  redirect(`/vip/pay/${order.id}`);
}

// 确认支付：目前由支付页的「我已完成支付」按钮触发。
// ⚠️ 未来接入支付宝/微信后，这段逻辑改由支付回调调用，页面无需改动。
export async function confirmPayment(orderId: number) {
  const user = await requireUser();

  // 校验订单属于当前用户且未支付，避免越权/重复
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== user.id) {
    redirect("/vip");
  }

  if (order.status !== "paid") {
    // 标记订单已支付
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "paid", paidAt: new Date() },
    });

    // 支付前的状态：既用来判断是不是"新增会员"，也用来查是否被人邀请（避免重复查询）
    const buyer = await prisma.user.findUnique({ where: { id: user.id } });

    // 开通永久会员（membershipExpiresAt 为空表示永久）
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isMember: true,
        membershipExpiresAt: null,
        ...(buyer && !buyer.isMember ? { memberSince: new Date() } : {}),
      },
    });

    // 如果这个买家是被人邀请来的，给推荐人生成一笔佣金记录
    // （orderId 唯一约束保证一笔订单只会产生一次佣金）
    if (buyer?.referredBy) {
      await prisma.commission.create({
        data: {
          referrerId: buyer.referredBy,
          orderId: order.id,
          amount: order.amount * COMMISSION_RATE,
        },
      });
    }

    // 立即刷新登录令牌，会员权限当场生效，无需重新登录
    await refreshSession();
  }

  // 刷新会受会员状态影响的页面缓存
  revalidatePath("/");
  revalidatePath("/vip");

  redirect("/vip?paid=1");
}
