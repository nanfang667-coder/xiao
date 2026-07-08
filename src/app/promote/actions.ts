"use server"; // 服务器操作：申请提现

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/user-auth";
import { MIN_WITHDRAW_AMOUNT, USDT_NETWORKS, withdrawalsEnabled } from "@/lib/membership";

// 申请提现：把当前所有"还没被其它提现申请占用"的佣金记录打包成一笔提现申请，
// 由管理员在后台人工审核、转账、标记发放。
export async function createWithdrawal(formData: FormData) {
  const user = await requireUser();

  // 服务端兜底：即使有人绕过前端页面直接提交，真实支付接入前也不放行提现
  if (!withdrawalsEnabled()) {
    redirect(`/promote?error=${encodeURIComponent("提现功能筹备中，敬请期待")}`);
  }

  const usdtAddress = String(formData.get("usdtAddress") ?? "").trim();
  const network = String(formData.get("network") ?? USDT_NETWORKS[0]);

  if (!usdtAddress) {
    redirect(`/promote?error=${encodeURIComponent("请填写USDT收款地址")}`);
  }
  if (!(USDT_NETWORKS as readonly string[]).includes(network)) {
    redirect(`/promote?error=${encodeURIComponent("网络类型不正确")}`);
  }

  // 提前估算一下大概金额，不够最低提现额就直接拒绝（真正的"认领"发生在下面的原子操作里）
  const estimateAgg = await prisma.commission.aggregate({
    where: { referrerId: user.id, withdrawalId: null },
    _sum: { amount: true },
  });
  if ((estimateAgg._sum.amount ?? 0) < MIN_WITHDRAW_AMOUNT) {
    redirect(
      `/promote?error=${encodeURIComponent(`可提现余额需满 ¥${MIN_WITHDRAW_AMOUNT} 才能申请`)}`
    );
  }

  // 原子地"认领"佣金：updateMany 的 WHERE 条件用 withdrawalId:null 去抢占，
  // 而不是先查出一批 id 再回头绑定——避免两次并发提交都读到同一批佣金、都抢到同一笔钱
  // （这批佣金一旦被认领，withdrawalId 就不再是 null，后来者的 WHERE 条件天然匹配不到它们）。
  const claimedAmount = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.withdrawal.create({
      data: { userId: user.id, amount: 0, usdtAddress, network, status: "pending" },
    });

    await tx.commission.updateMany({
      where: { referrerId: user.id, withdrawalId: null },
      data: { withdrawalId: withdrawal.id },
    });

    const actualAgg = await tx.commission.aggregate({
      where: { withdrawalId: withdrawal.id },
      _sum: { amount: true },
    });
    const actualAmount = actualAgg._sum.amount ?? 0;

    if (actualAmount < MIN_WITHDRAW_AMOUNT) {
      // 没抢到足够的佣金（大概率是并发撞车、被另一笔请求抢先了），撤销这笔申请
      await tx.commission.updateMany({
        where: { withdrawalId: withdrawal.id },
        data: { withdrawalId: null },
      });
      await tx.withdrawal.delete({ where: { id: withdrawal.id } });
      return null;
    }

    await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { amount: actualAmount } });
    return actualAmount;
  });

  if (claimedAmount === null) {
    redirect(
      `/promote?error=${encodeURIComponent("提现申请提交太快，请刷新页面后重试")}`
    );
  }

  revalidatePath("/promote");
  redirect("/promote?submitted=1");
}
