import { prisma } from "@/lib/prisma";
import { requireTeamAccount } from "@/lib/team-auth";
import { teamLogout } from "./actions";
import { MEMBERSHIP_PRODUCT_TYPE } from "@/lib/payment-products";

function money(value: number | null | undefined): string {
  return `¥${(value ?? 0).toFixed(2)}`;
}

export default async function TeamDashboardPage() {
  const account = await requireTeamAccount();
  const siteId = account.siteId;
  const now = Date.now();
  const dayStart = new Date(now - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const paid = { siteId, status: "paid" };

  const [
    totalUsers,
    monthUsers,
    totalMembers,
    monthMembers,
    dayVisitors,
    monthVisitors,
    totalVisitors,
    totalOrders,
    monthOrders,
    totalRevenue,
    monthRevenue,
    membershipRevenue,
    singlePostRevenue,
  ] = await Promise.all([
    prisma.user.count({ where: { siteId } }),
    prisma.user.count({ where: { siteId, createdAt: { gte: monthStart } } }),
    prisma.user.count({ where: { siteId, isMember: true } }),
    prisma.user.count({
      where: { siteId, isMember: true, memberSince: { gte: monthStart } },
    }),
    prisma.siteVisit.count({ where: { siteId, lastVisitedAt: { gte: dayStart } } }),
    prisma.siteVisit.count({ where: { siteId, lastVisitedAt: { gte: monthStart } } }),
    prisma.siteVisit.count({ where: { siteId } }),
    prisma.order.count({ where: paid }),
    prisma.order.count({ where: { ...paid, paidAt: { gte: monthStart } } }),
    prisma.order.aggregate({ where: paid, _sum: { amount: true } }),
    prisma.order.aggregate({
      where: { ...paid, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where: { ...paid, productType: MEMBERSHIP_PRODUCT_TYPE },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where: { ...paid, productType: { not: MEMBERSHIP_PRODUCT_TYPE } },
      _sum: { amount: true },
    }),
  ]);

  const cards = [
    ["总用户", totalUsers],
    ["近30天新增用户", monthUsers],
    ["当前会员", totalMembers],
    ["近30天新增会员", monthMembers],
    ["近24小时访客", dayVisitors],
    ["近30天访客", monthVisitors],
    ["累计独立访客", totalVisitors],
    ["支付成功订单", totalOrders],
    ["近30天支付订单", monthOrders],
    ["累计收入", money(totalRevenue._sum.amount)],
    ["近30天收入", money(monthRevenue._sum.amount)],
    ["会员收入", money(membershipRevenue._sum.amount)],
    ["单篇解锁收入", money(singlePostRevenue._sum.amount)],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center justify-between bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <div>
          <h1 className="font-bold">{account.site.name} · 团队数据看板</h1>
          <p className="mt-0.5 text-xs text-white/80">{account.site.hostname}</p>
        </div>
        <form action={teamLogout}>
          <button className="rounded-full bg-white/20 px-3 py-1 text-xs">退出</button>
        </form>
      </header>
      <p className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
        这里仅显示所属网站的汇总数据，所有内容和业务数据均不可修改。
      </p>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-2 text-xl font-bold text-pink-500">{value}</p>
          </div>
        ))}
      </section>
      <p className="mt-5 text-xs leading-5 text-gray-400">
        访客采用滚动24小时/30天口径；收入只统计支付成功订单，不包含待支付或失败订单。
      </p>
    </main>
  );
}
