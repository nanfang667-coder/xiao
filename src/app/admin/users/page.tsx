// 后台：用户管理模块
// 查看所有注册用户，按「会员/普通用户」筛选并统计数量，开通/取消会员，删除用户。

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UsersBrowser, type AdminUser, type NewMemberStats } from "./UsersBrowser";

// 把日期显示成 2026-07-07 这样的格式
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 新增会员统计：近24小时 / 近7天 / 近30天（按 memberSince 计算，续费/延期不算新增）
// 单独抽成函数调用，避免在组件渲染体里直接调用 Date.now()（React 的纯函数规则不允许）
function computeNewMemberStats(memberSinceDates: (Date | null)[]): NewMemberStats {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const times = memberSinceDates
    .map((d) => d?.getTime())
    .filter((t): t is number => t !== undefined);

  return {
    day: times.filter((t) => now - t <= DAY_MS).length,
    week: times.filter((t) => now - t <= 7 * DAY_MS).length,
    month: times.filter((t) => now - t <= 30 * DAY_MS).length,
  };
}

export default async function AdminUsersPage() {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

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

  const newMemberStats = computeNewMemberStats(rows.map((u) => u.memberSince));

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
      <UsersBrowser users={users} newMemberStats={newMemberStats} />
    </div>
  );
}
