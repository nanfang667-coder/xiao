// 我的推广页：展示专属邀请链接、邀请数据、佣金明细，并可申请提现（USDT）。

import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/user-auth";
import { prisma } from "@/lib/prisma";
import { COMMISSION_RATE, withdrawalsEnabled, withdrawMethodLabel } from "@/lib/membership";
import { CopyButton } from "./CopyButton";
import { WithdrawForm } from "./WithdrawForm";

// 根据当前访问的域名拼出邀请链接，跟着实际部署域名自动变化
// 不带协议头（不显示 https://），微信/短信里的链接识别、浏览器直接输入都能正常打开
async function getReferralLink(code: string): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  return `${host}/${code}`;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  paid: "已发放",
  rejected: "已驳回",
};

export default async function PromotePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const { error, submitted } = await searchParams;
  const user = await requireUser();
  const me = await prisma.user.findUnique({ where: { id: user.id } });
  if (!me) return null;

  const referralLink = await getReferralLink(me.referralCode);

  const [invitedCount, paidCount, totalAgg, availableAgg, recentCommissions, recentWithdrawals] =
    await Promise.all([
      prisma.user.count({ where: { referredBy: user.id } }),
      prisma.commission.count({ where: { referrerId: user.id } }),
      prisma.commission.aggregate({ where: { referrerId: user.id }, _sum: { amount: true } }),
      prisma.commission.aggregate({
        where: { referrerId: user.id, withdrawalId: null },
        _sum: { amount: true },
      }),
      prisma.commission.findMany({
        where: { referrerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.withdrawal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  const totalCommission = totalAgg._sum.amount ?? 0;
  const available = availableAgg._sum.amount ?? 0;

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">我的推广</h1>
      </header>

      {submitted === "1" && (
        <div className="mx-4 mt-4 rounded-xl bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-600">
          提现申请已提交，请等待人工审核
        </div>
      )}
      {error && (
        <div className="mx-4 mt-4 rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 邀请链接 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 p-5 text-white shadow-lg">
          <div className="text-sm text-white/90">
            邀请好友开通会员，你可获得 {COMMISSION_RATE * 100}% 佣金
          </div>
          <div className="mt-3 break-all rounded-xl bg-white/15 px-3 py-2 text-sm">
            {referralLink}
          </div>
          <CopyButton text={referralLink} />
        </div>
      </div>

      {/* 数据统计 */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="邀请注册人数" value={String(invitedCount)} />
          <StatCard label="邀请开通会员" value={String(paidCount)} />
          <StatCard label="累计佣金" value={`¥${totalCommission.toFixed(1)}`} />
          <StatCard label="可提现余额" value={`¥${available.toFixed(1)}`} highlight />
        </div>
      </div>

      {/* 申请提现：真实支付接入前暂不开放，避免自邀自邀套现 */}
      <div className="px-4 pt-4">
        {withdrawalsEnabled() ? (
          <WithdrawForm available={available} />
        ) : (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">申请提现</h2>
            <p className="py-4 text-center text-sm text-gray-400">
              提现功能筹备中，敬请期待～佣金会持续为你累计，不会丢失。
            </p>
          </div>
        )}
      </div>

      {/* 佣金明细 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">佣金明细</h2>
          {recentCommissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">暂无佣金记录</p>
          ) : (
            <div className="space-y-2">
              {recentCommissions.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{formatDate(c.createdAt)}</span>
                  <span className="font-medium text-rose-500">+¥{c.amount.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 提现记录 */}
      {recentWithdrawals.length > 0 && (
        <div className="px-4 pt-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-gray-800">提现记录</h2>
            <div className="space-y-2">
              {recentWithdrawals.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    {formatDate(w.createdAt)} · {withdrawMethodLabel(w.payMethod)}
                  </span>
                  <span className="font-medium text-gray-700">
                    ¥{w.amount.toFixed(1)} · {STATUS_LABEL[w.status] ?? w.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 shadow-sm ${
        highlight ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white" : "bg-white"
      }`}
    >
      <div className={`text-xs ${highlight ? "text-white/90" : "text-gray-400"}`}>{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
