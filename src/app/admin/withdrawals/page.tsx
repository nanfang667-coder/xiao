// 后台：提现审核模块
// 查看所有推广佣金提现申请，人工转账后标记发放，或驳回退回佣金。

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MarkPaidButton, RejectButton } from "./WithdrawalActions";

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  paid: "已发放",
  rejected: "已驳回",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-600",
  paid: "bg-green-100 text-green-600",
  rejected: "bg-gray-100 text-gray-500",
};

export default async function AdminWithdrawalsPage() {
  await requireAdmin();

  const withdrawals = await prisma.withdrawal.findMany({ orderBy: { createdAt: "desc" } });
  const userIds = [...new Set(withdrawals.map((w) => w.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const usernameOf = (id: number) => users.find((u) => u.id === id)?.username ?? `#${id}`;

  const pendingCount = withdrawals.filter((w) => w.status === "pending").length;
  const pendingAmount = withdrawals
    .filter((w) => w.status === "pending")
    .reduce((sum, w) => sum + w.amount, 0);

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/admin" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">提现审核</h1>
      </header>

      <p className="mb-4 text-xs text-gray-400">
        共 {withdrawals.length} 笔申请，其中 {pendingCount} 笔待处理（合计 ¥{pendingAmount.toFixed(1)}）
      </p>

      {/* 提现列表 */}
      <div className="space-y-3">
        {withdrawals.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">还没有提现申请</p>
        )}
        {withdrawals.map((w) => (
          <div key={w.id} className="rounded-2xl bg-white p-4 shadow-sm">
            {/* 第一行：用户名 + 状态标签 */}
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-800">{usernameOf(w.userId)}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[w.status] ?? "bg-gray-100 text-gray-500"}`}
              >
                {STATUS_LABEL[w.status] ?? w.status}
              </span>
            </div>

            {/* 第二行：金额、网络、地址、申请时间 */}
            <div className="mt-1.5 space-y-0.5 text-xs text-gray-400">
              <p>
                金额 <span className="font-medium text-rose-500">¥{w.amount.toFixed(1)}</span> ·
                网络 {w.network}
              </p>
              <p className="break-all">收款地址：{w.usdtAddress}</p>
              <p>申请于 {formatDate(w.createdAt)}</p>
              {w.paidAt && <p>发放于 {formatDate(w.paidAt)}</p>}
            </div>

            {/* 第三行：操作按钮（仅待处理状态显示） */}
            {w.status === "pending" && (
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-50 pt-3">
                <MarkPaidButton id={w.id} amount={w.amount} />
                <RejectButton id={w.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
