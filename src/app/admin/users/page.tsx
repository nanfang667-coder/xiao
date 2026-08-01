// 后台：用户管理模块
// 查看所有注册用户，按「会员/普通用户」筛选并统计数量，开通/取消会员，删除用户。

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UsersBrowser, type AdminUser, type ReferralVisitorStats } from "./UsersBrowser";

// 把日期显示成 2026-07-07 这样的格式
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 邀请独立访客统计：同一浏览器访问同一用户链接只占一条记录。
// 按最后访问时间统计近期仍通过邀请链接进入网站的访客。
async function getReferralVisitorStats(): Promise<ReferralVisitorStats> {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const [day, week, month] = await Promise.all([
    prisma.referralVisit.count({
      where: { lastVisitedAt: { gte: new Date(now - DAY_MS) } },
    }),
    prisma.referralVisit.count({
      where: { lastVisitedAt: { gte: new Date(now - 7 * DAY_MS) } },
    }),
    prisma.referralVisit.count({
      where: { lastVisitedAt: { gte: new Date(now - 30 * DAY_MS) } },
    }),
  ]);

  return { day, week, month };
}

export default async function AdminUsersPage() {
  await requireAdmin();
  const [rows, referralVisitorStats] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { referralVisits: true } },
      },
    }),
    getReferralVisitorStats(),
  ]);

  // 转成安全的展示数据（去掉密码等敏感字段，日期先格式化好）
  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    referralCode: u.referralCode,
    referralVisitorCount: u._count.referralVisits,
    isMember: u.isMember,
    createdAtLabel: formatDate(u.createdAt),
    expiryLabel: u.isMember
      ? u.membershipExpiresAt
        ? `会员到期：${formatDate(u.membershipExpiresAt)}`
        : "永久会员"
      : null,
    memberSinceLabel: u.memberSince ? formatDate(u.memberSince) : null,
    isBanned: u.isBanned,
    bannedAtLabel: u.bannedAt ? formatDate(u.bannedAt) : null,
    banReason: u.banReason,
  }));

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/admin" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">用户管理</h1>
      </header>

      {/* 筛选 + 列表（客户端交互） */}
      <UsersBrowser users={users} referralVisitorStats={referralVisitorStats} />
    </div>
  );
}
