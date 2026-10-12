import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePage } from "@/lib/pagination";
import { isTeamQuotaHistoryReady } from "@/lib/team-quota-history-readiness";

const PATH = "/adminzhangzhang/sites/quota-history";
const PAGE_SIZE = 20;
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function historyHref(account: number | undefined, query: string, month: string, page = 1) {
  const params = new URLSearchParams();
  if (account) params.set("account", String(account));
  if (query) params.set("q", query);
  if (month) params.set("month", month);
  if (page > 1) params.set("page", String(page));
  return params.size ? `${PATH}?${params}` : PATH;
}

function eventLabel(kind: string) {
  if (kind === "allowance_added") return "追加额度";
  if (kind === "base_changed") return "调整基础额度";
  if (kind === "account_created") return "创建账号";
  return "额度变更";
}

export default async function TeamQuotaHistoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const accountValue = first(params.account);
  const accountNumber = Number(accountValue);
  const account = /^\d+$/.test(accountValue) && Number.isSafeInteger(accountNumber)
    && accountNumber > 0 && accountNumber <= 2_147_483_647 ? accountNumber : undefined;
  const query = first(params.q).trim().slice(0, 32);
  const monthValue = first(params.month);
  const month = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(monthValue) ? monthValue : "";
  const where: Prisma.TeamPostQuotaEventWhereInput = {
    ...(account ? { teamAccountId: account } : {}),
    ...(query ? { teamUsername: { contains: query } } : {}),
  };
  if (month) {
    const [year, monthNumber] = month.split("-").map(Number);
    const gte = new Date(Date.UTC(year, monthNumber - 1, 1) - 8 * 60 * 60 * 1000);
    const lt = new Date(Date.UTC(year, monthNumber, 1) - 8 * 60 * 60 * 1000);
    where.OR = [
      { kind: { not: "legacy_snapshot" }, createdAt: { gte, lt } },
      { kind: "legacy_snapshot", legacyMonth: month },
    ];
  }
  const ready = await isTeamQuotaHistoryReady();
  const total = ready ? await prisma.teamPostQuotaEvent.count({ where }) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(params.page), totalPages);
  const events = ready ? await prisma.teamPostQuotaEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, teamAccountId: true, teamUsername: true, kind: true, delta: true,
      previousLimit: true, newLimit: true, legacyBonus: true, legacyMonth: true, createdAt: true,
    },
  }) : [];
  const input = "min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex flex-wrap items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/adminzhangzhang/sites" className="text-white/90">← 团队账号</Link>
        <h1 className="font-bold">团队额度记录</h1>
      </header>

      <section className="mb-5 rounded-2xl bg-white p-4 text-sm leading-6 text-gray-600 shadow-sm" aria-label="额度记录说明">
        <p>可查看给哪个团队增加了多少额度，以及调整前后的总额度。操作时间均为北京时间。</p>
        <p className="mt-2">此功能启用前没有逐次操作记录。旧数据快照仅保留当时尚存的累计追加额度，无法还原每次追加的条数、时间或已被覆盖的数据。</p>
        <p className="mt-2">筛选月份时，操作记录按实际操作时间查询；旧数据快照按来源月份标记查询。快照中的追加总量不等于该月增加的额度。</p>
      </section>

      <form action={PATH} method="get" className="mb-4 flex flex-wrap items-end gap-3">
        {account && <input type="hidden" name="account" value={account} />}
        <label className="grid min-w-0 flex-1 gap-1 text-sm text-gray-600">团队账号
          <input key={query} name="q" type="search" maxLength={32} defaultValue={query}
            placeholder="输入账号搜索" className={input} />
        </label>
        <label className="grid gap-1 text-sm text-gray-600">月份
          <input key={month} name="month" type="month" defaultValue={month} className={input} />
        </label>
        <button className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white">查询</button>
        {(account || query || month) && <Link href={PATH} className="pb-2 text-sm text-gray-500">清除筛选</Link>}
      </form>
      {account && <p className="mb-3 text-xs text-gray-500">当前仅显示账号编号 {account} 的记录。<Link href={historyHref(undefined, query, month)} className="ml-2 text-pink-600">查看所有账号</Link></p>}

      {!ready ? <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">额度记录暂不可用，请稍后再试。</p> : <>
        <p className="mb-3 text-xs text-gray-500">共 {total} 条记录，每页最多 {PAGE_SIZE} 条{month ? ` · 筛选月份 ${month}` : ""}</p>
        <section className="space-y-3" aria-label="团队额度记录列表">
          {events.map((event) => {
            const legacy = event.kind === "legacy_snapshot";
            return <article key={event.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="break-all font-bold text-gray-800">{event.teamUsername}</h2>
                <span className={`rounded-full px-2 py-1 text-xs ${legacy ? "bg-amber-50 text-amber-800" : "bg-pink-50 text-pink-700"}`}>
                  {legacy ? "旧数据快照" : `操作记录 · ${eventLabel(event.kind)}`}
                </span>
              </div>
              {event.teamAccountId === null && <p className="mt-1 text-xs text-gray-400">账号已删除，记录仍保留</p>}
              {legacy ? <div className="mt-3 space-y-1 text-sm text-gray-600">
                <p>保留的累计追加额度：<strong className="text-gray-800">{event.legacyBonus ?? "未知"} 条</strong></p>
                <p>快照时总额度：{event.newLimit} 条</p>
                <p>来源月份标记：{event.legacyMonth || "未知"}（不是该月增加条数）</p>
                <p className="text-xs text-amber-800">实际操作时间和逐次条数未知</p>
                <p className="text-xs text-gray-400">快照采集时间：<time dateTime={event.createdAt.toISOString()}>{dateFormat.format(event.createdAt)}</time></p>
              </div> : <div className="mt-3 space-y-1 text-sm text-gray-600">
                <p>本次额度变化：<strong className={event.delta !== null && event.delta < 0 ? "text-amber-700" : "text-pink-600"}>
                  {event.delta === null ? "未知" : `${event.delta > 0 ? "+" : ""}${event.delta}`} 条
                </strong></p>
                <p>总额度：{event.previousLimit ?? "—"} → {event.newLimit} 条</p>
                <p className="text-xs text-gray-400">操作时间：<time dateTime={event.createdAt.toISOString()}>{dateFormat.format(event.createdAt)}</time></p>
              </div>}
            </article>;
          })}
          {events.length === 0 && <p className="py-10 text-center text-sm text-gray-500">没有符合条件的记录。旧数据未保存逐次操作，不能据此判断当时是否追加过额度。</p>}
        </section>
        {totalPages > 1 && <nav aria-label="额度记录分页" className="mt-5 flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link href={historyHref(account, query, month, page - 1)} className="text-pink-600">上一页</Link>}
          <span className="text-gray-500">第 {page} / {totalPages} 页</span>
          {page < totalPages && <Link href={historyHref(account, query, month, page + 1)} className="text-pink-600">下一页</Link>}
        </nav>}
      </>}
    </main>
  );
}
