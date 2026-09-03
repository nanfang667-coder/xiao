import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTeamAccount } from "@/lib/team-auth";
import { teamLogout } from "./actions";

export default async function TeamDashboardPage() {
  const account = await requireTeamAccount();
  // Server-side request time is intentionally used for the rolling visitor window.
  // eslint-disable-next-line react-hooks/purity
  const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [dayVisitors, postCount, postViews, pendingCount] = await Promise.all([
    prisma.siteVisit.count({
      where: { siteId: account.siteId, lastVisitedAt: { gte: dayStart } },
    }),
    prisma.teacherOwnership.count({ where: { teamAccountId: account.id } }),
    prisma.teacher.aggregate({
      where: { ownership: { teamAccountId: account.id } },
      _sum: { viewCount: true },
    }),
    prisma.teacherSubmission.count({
      where: { teamAccountId: account.id, status: "pending" },
    }),
  ]);

  const cards = [
    ["全站近24小时独立访客", dayVisitors],
    ["我的已发布帖子", postCount],
    ["我的帖子总浏览次数", postViews._sum.viewCount ?? 0],
    ["待管理员审核", pendingCount],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center justify-between bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <div>
          <h1 className="font-bold">{account.site.name} · 合作后台</h1>
          <p className="mt-0.5 text-xs text-white/80">账号：{account.username}</p>
        </div>
        <form action={teamLogout}>
          <button className="rounded-full bg-white/20 px-3 py-1 text-xs">退出</button>
        </form>
      </header>

      <section className="grid grid-cols-2 gap-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-2 text-xl font-bold text-pink-500">
              {Number(value).toLocaleString("zh-CN")}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link href="/team/posts" className="rounded-xl border border-pink-200 bg-white px-4 py-3 text-center text-sm font-bold text-pink-600">
          管理我的帖子
        </Link>
        <Link href="/team/posts/new" className="rounded-xl bg-pink-500 px-4 py-3 text-center text-sm font-bold text-white">
          ＋ 发布新帖
        </Link>
      </div>

      <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
        新帖子和修改内容提交后由管理员审核；修改待审核期间，线上原帖继续正常展示。
      </p>
    </main>
  );
}
