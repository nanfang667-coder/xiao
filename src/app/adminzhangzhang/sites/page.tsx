import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePage } from "@/lib/pagination";
import {
  getEffectiveTeamPostLimit,
  getTeamPostBaseLimit,
  getTeamPostUsageWhere,
  summarizeTeamPostQuota,
} from "@/lib/team-post-quota";
import {
  addTeamMonthlyPostAllowance,
  createTeamAccount,
  resetTeamPassword,
  updateTeamMonthlyPostLimit,
} from "./actions";
import { DeleteTeamAccountButton } from "./DeleteTeamAccountButton";

const PAGE_SIZE = 20;
const PATH = "/adminzhangzhang/sites";

function pageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return params.size ? `${PATH}?${params}` : PATH;
}

export default async function TeamAccountManagementPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] ?? "" : params.q ?? "").trim().slice(0, 32);
  const where = query ? { username: { contains: query } } : {};
  const [sites, total] = await Promise.all([
    prisma.site.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, hostname: true },
    }),
    prisma.teamAccount.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(params.page), totalPages);
  const accounts = await prisma.teamAccount.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, username: true, isActive: true,
      monthlyPostLimit: true, monthlyPostLimitOverride: true,
      monthlyPostBonus: true,
      _count: { select: { teacherOwnerships: true } },
    },
  });
  const usage = accounts.length ? await prisma.teacherSubmission.groupBy({
    by: ["teamAccountId"],
    where: {
      ...getTeamPostUsageWhere(),
      teamAccountId: { in: accounts.map((account) => account.id) },
    },
    _count: { _all: true },
  }) : [];
  const totalUsage = new Map(usage.map((row) => [row.teamAccountId, row._count._all]));
  const input = "min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex flex-wrap items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="font-bold">团队账号管理</h1>
        <Link href="/adminzhangzhang/sites/quota-history" className="ml-auto text-sm text-white/90">额度记录</Link>
        <Link href="/adminzhangzhang/submissions" className="text-sm text-white/90">合作帖子管理 →</Link>
      </header>

      <section className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-bold text-gray-800">添加团队账号</h2>
        {sites.length ? <form action={createTeamAccount} className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-gray-600">账号
            <input name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
              autoComplete="off" placeholder="3–32位字母、数字、下划线或短横线" className={input} />
          </label>
          <label className="grid gap-1 text-sm text-gray-600">初始密码
            <input name="password" type="password" required minLength={12} autoComplete="new-password"
              placeholder="至少12位" className={input} />
          </label>
          <label className="grid gap-1 text-sm text-gray-600">基础发帖额度
            <select name="monthlyPostLimit" defaultValue="22" className={input}>
              <option value="22">22条</option><option value="150">150条</option>
            </select>
          </label>
          {sites.length > 1 ? <label className="grid gap-1 text-sm text-gray-600">账号所属站点
            <select name="siteId" defaultValue={sites[0].id} className={input}>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}（{site.hostname}）</option>)}
            </select>
          </label> : <input type="hidden" name="siteId" value={sites[0].id} />}
          <div className="sm:col-span-2">
            <button className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white">创建团队账号</button>
          </div>
        </form> : <p className="text-sm text-gray-500">当前没有可用站点，暂时无法创建账号。</p>}
      </section>

      <p className="mb-3 text-xs text-gray-500">额度跨月保留，不会自动重置。待审核及已通过的新帖累计占用额度，管理员可追加额度。</p>
      <form action={PATH} method="get" className="mb-3 flex gap-2">
        <input key={query} name="q" type="search" maxLength={32} defaultValue={query}
          aria-label="搜索团队账号" placeholder="搜索团队账号" className={`${input} flex-1`} />
        <button className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white">搜索</button>
        {query && <Link href={PATH} className="self-center text-sm text-gray-500">清除</Link>}
      </form>
      <p className="mb-3 text-xs text-gray-500">共 {total} 个账号，每页最多 {PAGE_SIZE} 个</p>
      <section className="space-y-3" aria-label="团队账号列表">
        {accounts.map((account) => {
          const baseLimit = getTeamPostBaseLimit(account);
          const quota = summarizeTeamPostQuota(getEffectiveTeamPostLimit(account), totalUsage.get(account.id) ?? 0);
          const bonus = quota.limit - baseLimit;
          return <article key={account.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="break-all font-bold text-gray-800">{account.username}</h2>
              <span className={`text-xs ${account.isActive ? "text-green-600" : "text-gray-400"}`}>{account.isActive ? "使用中" : "已停用"}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>累计已用 {quota.used}/{quota.limit} 条 · 剩余 {quota.remaining} 条{bonus > 0 ? `（基础 ${baseLimit} + 追加 ${bonus}）` : ""}</span>
              <Link href={`/adminzhangzhang/submissions?account=${account.id}&view=published`} className="text-pink-600">已发布 {account._count.teacherOwnerships} 条 · 查看帖子</Link>
              <Link href={`/adminzhangzhang/sites/quota-history?account=${account.id}`} className="text-pink-600">额度记录</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <form action={updateTeamMonthlyPostLimit.bind(null, account.id)} className="flex gap-2">
                <select name="monthlyPostLimit" defaultValue={baseLimit} aria-label={`${account.username}基础发帖额度`} className={`${input} flex-1`}>
                  <option value="22">22条</option>
                  {baseLimit === 30 && <option value="30">30条（原账号）</option>}
                  <option value="150">150条</option>
                </select>
                <button className="shrink-0 rounded-lg border border-gray-200 px-3 text-xs text-gray-600">保存额度</button>
              </form>
              <form action={addTeamMonthlyPostAllowance.bind(null, account.id)} className="flex gap-2">
                <input name="amount" type="number" required min="1" max="1000" step="1" aria-label={`${account.username}增加发帖条数`}
                  placeholder="增加条数（跨月保留）" className={`${input} w-0 flex-1`} />
                <button className="shrink-0 rounded-lg border border-amber-200 px-3 text-xs text-amber-700">增加额度</button>
              </form>
              <form action={resetTeamPassword.bind(null, account.id)} className="flex gap-2 sm:col-span-2">
                <input name="password" type="password" required minLength={12} autoComplete="new-password" aria-label={`${account.username}新密码`}
                  placeholder="新密码（至少12位）" className={`${input} flex-1`} />
                <button className="shrink-0 rounded-lg border border-pink-200 px-3 text-xs text-pink-600">重设密码并启用</button>
              </form>
            </div>
            <div className="mt-4 border-t border-gray-100 pt-3">
              <DeleteTeamAccountButton accountId={account.id} username={account.username} />
            </div>
          </article>;
        })}
        {accounts.length === 0 && <p className="py-10 text-center text-sm text-gray-400">没有匹配的团队账号</p>}
      </section>
      {totalPages > 1 && <nav aria-label="团队账号分页" className="mt-5 flex items-center justify-center gap-4 text-sm">
        {page > 1 && <Link href={pageHref(query, page - 1)} className="text-pink-600">上一页</Link>}
        <span className="text-gray-500">第 {page} / {totalPages} 页</span>
        {page < totalPages && <Link href={pageHref(query, page + 1)} className="text-pink-600">下一页</Link>}
      </nav>}
    </main>
  );
}
