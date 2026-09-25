import Link from "next/link";
import { getCooperationManagement } from "@/lib/admin-cooperation";
import {
  COOPERATION_PATH, COOPERATION_PAGE_SIZE, cooperationHref,
  parseCooperationFilters, type CooperationFilters,
} from "@/lib/cooperation-filters";
import { isImage } from "@/lib/photo";
import { DeleteTeacherButton } from "../DeleteTeacherButton";
import { approveTeacherSubmission, rejectTeacherSubmission } from "./actions";

function photosFrom(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string" && isImage(p)) : [];
  } catch { return []; }
}

function dateLabel(value: Date | null | undefined): string {
  return value ? value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "暂无";
}

function Thumbnail({ photos, emoji }: { photos: string; emoji: string }) {
  const photo = photosFrom(photos)[0];
  return photo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={photo} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
    : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-2xl">{emoji}</span>;
}

function HiddenFilters({ filters, omit = [] }: { filters: CooperationFilters; omit?: string[] }) {
  const params = new URLSearchParams(cooperationHref(filters).split("?")[1] ?? "");
  return [...params].filter(([key]) => !omit.includes(key)).map(([key, value]) => (
    <input key={key} type="hidden" name={key} value={value} />
  ));
}

function Pagination({ filters, page, totalPages, accounts = false }: {
  filters: CooperationFilters; page: number; totalPages: number; accounts?: boolean;
}) {
  if (totalPages <= 1) return null;
  const href = (next: number) => cooperationHref(filters, accounts ? { accountPage: next } : { page: next });
  const style = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600";
  return (
    <nav aria-label={accounts ? "账号分页" : "帖子分页"} className="mt-4 flex flex-wrap items-center justify-center gap-3">
      {page > 1 && <Link href={href(page - 1)} className={style}>上一页</Link>}
      <span className="text-xs text-gray-500">第 {page} / {totalPages} 页</span>
      {page < totalPages && <Link href={href(page + 1)} className={style}>下一页</Link>}
    </nav>
  );
}

export default async function CooperationManagementPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseCooperationFilters(await searchParams);
  const result = await getCooperationManagement(filters);
  const current = { ...filters, page: result.pagination.page, accountPage: result.accountPagination.page };
  const accountHref = (accountId: number | null) => cooperationHref(current, { accountId, page: 1 });
  const returnTo = cooperationHref(current);
  const button = "rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white";
  const input = "min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="font-bold">合作帖子管理</h1>
        <Link href="/adminzhangzhang/sites" className="ml-auto text-sm text-white/90">团队账号 →</Link>
      </header>

      <section aria-label="合作账号汇总" className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-gray-800">按合作账号查看</h2>
          <Link href={accountHref(null)} aria-current={current.accountId === null ? "true" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${current.accountId === null ? "bg-pink-500 text-white" : "bg-pink-50 text-pink-600"}`}>
            全部账号
          </Link>
        </div>
        <form action={COOPERATION_PATH} method="get" className="my-3 flex gap-2">
          <HiddenFilters filters={current} omit={["accountQ", "accountPage"]} />
          <input name="accountQ" type="search" aria-label="搜索合作账号" placeholder="搜索合作账号" maxLength={32}
            defaultValue={current.accountQuery} className={`${input} flex-1`} />
          <button className={button}>查找</button>
        </form>
        <p className="mb-3 text-xs text-gray-400">共 {result.accountPagination.total} 个账号，有待审核内容的优先显示；数量包含该账号所有地区的帖子。</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {result.accounts.map((account) => (
            <Link key={account.id} href={accountHref(account.id)}
              aria-current={current.accountId === account.id ? "true" : undefined}
              className={`min-w-0 rounded-xl border p-3 ${current.accountId === account.id ? "border-pink-400 bg-pink-50" : "border-gray-100 bg-gray-50"}`}>
              <div className="flex items-center gap-2">
                <span className="break-all text-sm font-bold text-gray-800">{account.username}</span>
                {!account.isActive && <span className="shrink-0 text-xs text-gray-400">已停用</span>}
              </div>
              <p className="mt-1 text-xs text-gray-600">
                <span className="font-semibold text-amber-700">待审核 {account._count.submissions}</span>
                <span className="ml-4">已发布 {account._count.teacherOwnerships}</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">最近投稿：{dateLabel(account.submissions[0]?.createdAt)}</p>
            </Link>
          ))}
        </div>
        {result.accounts.length === 0 && <p className="py-4 text-center text-sm text-gray-400">没有匹配的合作账号</p>}
        <Pagination filters={current} {...result.accountPagination} accounts />
      </section>

      <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm" aria-label="帖子筛选">
        <h2 className="mb-3 break-all font-bold text-gray-800">
          {current.accountId === null ? "全部合作帖子" : `发布账号：${result.selectedAccount?.username ?? "账号不存在"}`}
        </h2>
        <nav aria-label="帖子状态" className="mb-4 flex flex-wrap gap-2">
          {([
            ["pending", "待审核"], ["published", "已发布"], ["history", "审核记录"],
          ] as const).map(([view, label]) => (
            <Link key={view} href={cooperationHref(current, { view, page: 1 })} aria-current={current.view === view ? "page" : undefined}
              className={`rounded-full px-3 py-2 text-sm ${current.view === view ? "bg-pink-500 font-bold text-white" : "bg-gray-100 text-gray-600"}`}>
              {label} {result.counts[view]}
            </Link>
          ))}
        </nav>
        <form action={COOPERATION_PATH} method="get" className="grid gap-2 sm:grid-cols-2">
          <HiddenFilters filters={current} omit={["q", "region", "page", "status"]} />
          <input name="q" type="search" defaultValue={current.query} aria-label="搜索标题或编号" maxLength={100}
            placeholder="搜索标题、帖子编号或投稿编号" className={input} />
          <input name="region" type="search" defaultValue={current.region} aria-label="搜索地区" maxLength={100}
            placeholder="地区，如广东、广州" className={input} />
          {current.view === "history" && (
            <select name="status" defaultValue={current.historyStatus} aria-label="审核结果" className={input}>
              <option value="">全部审核结果</option><option value="approved">已通过</option><option value="rejected">未通过</option>
            </select>
          )}
          <div className="flex items-center gap-3">
            <button className={button}>搜索帖子</button>
            <Link href={cooperationHref(current, { query: "", region: "", historyStatus: "", page: 1 })} className="text-sm text-gray-500">清除条件</Link>
          </div>
        </form>
      </section>
      <p className="mb-3 text-xs text-gray-500">当前条件共 {result.pagination.total} {current.view === "history" ? "条审核记录" : "条"}，每页最多 {COOPERATION_PAGE_SIZE} 条。{current.view === "history" && "同一帖子可有多次投稿记录。"}</p>

      <section className="space-y-3" aria-label="合作帖子列表">
        {result.ownerships.map(({ teacher, account, teamAccountId }) => (
          <article key={teacher.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <Thumbnail photos={teacher.photos} emoji={teacher.emoji} />
              <div className="min-w-0 flex-1">
                <Link href={accountHref(teamAccountId)} className="break-all text-xs font-semibold text-pink-600">发布账号：{account.username}</Link>
                <h3 className="mt-1 break-words font-bold text-gray-800">#{teacher.id} {teacher.name}</h3>
                <p className="mt-1 text-xs text-gray-500">{teacher.city} {teacher.district} · {teacher.price}</p>
                <p className="mt-1 text-xs text-gray-400">发布于 {dateLabel(teacher.createdAt)} · 浏览 {teacher.viewCount} 次</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link href={`/listing/${teacher.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600">查看帖子 ↗</Link>
              <Link href={`/adminzhangzhang/${teacher.id}/edit?returnTo=${encodeURIComponent(returnTo)}`} className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600">编辑</Link>
              <DeleteTeacherButton id={teacher.id} name={teacher.name} />
            </div>
          </article>
        ))}
        {result.submissions.map((submission) => (
          <article key={submission.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <Thumbnail photos={submission.status === "pending" ? submission.photos : "[]"} emoji={submission.emoji} />
              <div className="min-w-0 flex-1">
                <Link href={accountHref(submission.teamAccountId)} className="break-all text-xs font-semibold text-pink-600">发布账号：{submission.account.username}</Link>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${submission.status === "rejected" ? "bg-red-50 text-red-600" : submission.status === "approved" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {submission.status === "pending" ? "待审核" : submission.status === "approved" ? "已通过" : "未通过"}
                  </span>
                  <span className="text-gray-500">{submission.kind === "create" ? "新帖子" : "修改帖子"} · 投稿 #{submission.id}{submission.teacherId ? ` · 帖子 #${submission.teacherId}` : ""}</span>
                </div>
                <h3 className="mt-1 break-words font-bold text-gray-800">{submission.name}</h3>
                <p className="mt-1 text-xs text-gray-500">{submission.city} {submission.district} · {submission.price}</p>
                <p className="mt-1 text-xs text-gray-400">投稿于 {dateLabel(submission.createdAt)}</p>
                {submission.reviewedAt && <p className="mt-1 text-xs text-gray-400">审核于 {dateLabel(submission.reviewedAt)}</p>}
              </div>
            </div>
            {submission.reviewNote && <p className="mt-3 break-words rounded-lg bg-red-50 p-2 text-sm text-red-700">未通过说明：{submission.reviewNote}</p>}
            <details className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
              <summary className="cursor-pointer font-medium text-pink-600">展开投稿详情</summary>
              <div className="mt-3 space-y-2 break-words leading-6">
                <p>服务内容：{submission.services}</p>
                {submission.courseNotes && <p className="whitespace-pre-wrap">详细说明：{submission.courseNotes}</p>}
                <p>联系方式：{[submission.phone, submission.wechat, submission.qq, submission.otherContact].filter(Boolean).join(" / ") || "未填写"}</p>
                {submission.address && <p>地址：{submission.address}</p>}
                {submission.status === "pending" && <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photosFrom(submission.photos).map((src, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${src}-${index}`} src={src} alt={`投稿图片 ${index + 1}`} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
                  ))}
                </div>}
              </div>
            </details>
            {submission.teacherId ? (
              <Link href={`/listing/${submission.teacherId}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-sky-600">查看当前线上版本 ↗</Link>
            ) : submission.status === "approved" && <p className="mt-3 text-xs text-gray-400">原帖已删除，保留审核记录</p>}
            {submission.status === "pending" && <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
              <form action={approveTeacherSubmission.bind(null, submission.id)}>
                <button className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white">审核通过</button>
              </form>
              <form action={rejectTeacherSubmission.bind(null, submission.id)} className="contents">
                <input name="reviewNote" maxLength={300} aria-label={`投稿 ${submission.id} 未通过说明`} placeholder="未通过说明（选填）" className={input} />
                <button className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-600">不通过</button>
              </form>
            </div>}
          </article>
        ))}
        {result.pagination.total === 0 && <p className="rounded-2xl bg-white py-12 text-center text-sm text-gray-400">当前条件下没有{current.view === "pending" ? "待审核内容" : current.view === "published" ? "已发布帖子" : "审核记录"}</p>}
      </section>
      <Pagination filters={current} {...result.pagination} />
    </main>
  );
}
