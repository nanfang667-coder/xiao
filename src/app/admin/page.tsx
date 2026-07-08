// 后台管理首页：模块入口
// 老师管理 / 用户管理

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logout } from "./actions";

export default async function AdminDashboard() {
  await requireAdmin(); // 未登录会被挡下

  // 各模块的数据量，显示在入口卡片上
  const [teacherCount, userCount, pendingWithdrawals] = await Promise.all([
    prisma.teacher.count(),
    prisma.user.count(),
    prisma.withdrawal.count({ where: { status: "pending" } }),
  ]);

  const modules = [
    {
      href: "/admin/teachers",
      icon: "🎹",
      title: "老师管理",
      desc: "添加、编辑、删除老师信息",
      count: `${teacherCount} 位老师`,
    },
    {
      href: "/admin/users",
      icon: "👤",
      title: "用户管理",
      desc: "查看用户、开通/取消会员",
      count: `${userCount} 个用户`,
    },
    {
      href: "/admin/withdrawals",
      icon: "💸",
      title: "提现审核",
      desc: "推广佣金提现申请，人工转账后标记发放",
      count: `${pendingWithdrawals} 笔待处理`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <h1 className="text-lg font-bold">后台管理</h1>
        <form action={logout}>
          <button className="rounded-full bg-white/20 px-3 py-1 text-xs">
            退出登录
          </button>
        </form>
      </header>

      {/* 模块入口卡片 */}
      <div className="space-y-3">
        {modules.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm active:scale-[0.99] transition"
          >
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-pink-50 text-2xl">
              {m.icon}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-gray-800">{m.title}</h2>
              <p className="mt-0.5 text-xs text-gray-400">{m.desc}</p>
            </div>
            <div className="flex flex-none items-center gap-1 text-xs text-gray-400">
              <span>{m.count}</span>
              <span className="text-gray-300">›</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
