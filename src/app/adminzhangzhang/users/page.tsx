// 后台：用户管理模块
// 查看所有注册用户和历史会员状态，支持筛选、封禁、解封和删除用户。

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import {
  getLast24HourVisitorCount,
  getTodayNewVisitorCount,
} from "@/lib/site-visitor-stats";
import { prisma } from "@/lib/prisma";
import {
  UsersBrowser,
  type AdminUser,
  type SiteVisitorStats,
} from "./UsersBrowser";

// 把日期显示成 2026-07-07 这样的格式
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 全站独立访客统计：与合作后台共用今日新增和近24小时口径。
// 今日新增按首次访问时间；近24小时和近30天按最后访问时间。
async function getSiteVisitorStats(): Promise<SiteVisitorStats> {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const [today, day, total, month] = await Promise.all([
    getTodayNewVisitorCount(new Date(now)),
    getLast24HourVisitorCount(new Date(now)),
    prisma.siteVisit.count(),
    prisma.siteVisit.count({
      where: { lastVisitedAt: { gte: new Date(now - 30 * DAY_MS) } },
    }),
  ]);

  return { today, day, total, month };
}

export default async function AdminUsersPage() {
  await requireAdmin();
  const [rows, siteVisitorStats] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    }),
    getSiteVisitorStats(),
  ]);

  // 转成安全的展示数据（去掉密码等敏感字段，日期先格式化好）
  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
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
        <Link href="/adminzhangzhang" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">用户管理</h1>
      </header>

      {/* 筛选 + 列表（客户端交互） */}
      <UsersBrowser
        users={users}
        siteVisitorStats={siteVisitorStats}
      />
    </div>
  );
}
