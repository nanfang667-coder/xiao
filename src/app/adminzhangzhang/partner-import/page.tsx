import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import { parsePage } from "@/lib/pagination";
import { DEFAULT_PARTNER_IMPORT_RULES } from "@/lib/partner-import-parser";
import { ImportForms } from "./ImportForms";
import { DraftList } from "./DraftList";
import { JobList } from "./JobList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "合作网站导入", robots: { index: false, follow: false }, referrer: "no-referrer" };
const path = "/adminzhangzhang/partner-import";
const pageSize = 20;
const jobPageSize = 10;

function dateLabel(date: Date) {
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export default async function PartnerImportPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const assignmentReady = await isPartnerImportAssignmentReady();
  const params = await searchParams;
  const statusOptions = assignmentReady
    ? [["pending", "待初审"], ["ready", "待分配"], ["assigned", "成员处理中"], ["returned", "退回修改"], ["submitted", "待终审"], ["published", "已发布"], ["rejected", "已拒绝"], ["all", "全部"]]
    : [["pending", "待审查"], ["published", "已发布"], ["rejected", "已拒绝"], ["all", "全部"]];
  const status = typeof params.status === "string" && statusOptions.some(([value]) => value === params.status)
    ? params.status : "pending";
  const where = status === "all" ? {} : { status };
  const [sources, total, jobTotal, teamAccounts] = await Promise.all([
    prisma.partnerImportSource.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, origin: true, rules: true, imageOrigins: true } }),
    prisma.partnerImportDraft.count({ where }),
    prisma.partnerImportJob.count(),
    assignmentReady ? prisma.teamAccount.findMany({ where: { isActive: true, site: { isActive: true } }, orderBy: { username: "asc" }, select: { id: true, username: true } }) : [],
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(parsePage(params.page), totalPages);
  const jobPages = Math.max(1, Math.ceil(jobTotal / jobPageSize));
  const jobPage = Math.min(parsePage(params.jobsPage), jobPages);
  const [drafts, jobs] = await Promise.all([
    prisma.partnerImportDraft.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize,
      select: { id: true, version: true, status: true, createdAt: true, post: { select: { source: { select: { name: true } } } }, ...(assignmentReady ? { assignedAccount: { select: { username: true } } } : {}) },
    }),
    prisma.partnerImportJob.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: jobPageSize, skip: (jobPage - 1) * jobPageSize,
      select: { id: true, createdAt: true, source: { select: { name: true } }, _count: { select: { items: true } } },
    }),
  ]);
  const href = (next: { status?: string; page?: number; jobsPage?: number }) => `${path}?${new URLSearchParams({
    status: next.status ?? status, page: String(next.page ?? page), jobsPage: String(next.jobsPage ?? jobPage),
  })}`;
  const pageButton = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600";

  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex flex-wrap items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/adminzhangzhang" className="text-sm text-white/90">← 后台</Link>
      <h1 className="font-bold">合作网站导入</h1>
      <a href="#drafts" className="ml-auto text-sm text-white/90">查看待审区 ↓</a>
    </header>
    {!assignmentReady && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">团队分配功能尚未启用，当前可继续导入和审核。</p>}
    <ImportForms sources={sources} defaultRules={JSON.stringify(DEFAULT_PARTNER_IMPORT_RULES, null, 2)} />

    <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="jobs-heading">
      <h2 id="jobs-heading" className="font-bold text-gray-800">导入任务</h2>
      <p className="mt-2 text-xs leading-5 text-gray-500">共 {jobTotal} 个任务。打开任务后点击开始或继续；离开任务页后停止发起新的下载，已经开始的一条可能仍会完成。</p>
      <JobList key={jobPage} jobs={jobs.map(job => ({
        id: job.id, sourceName: job.source.name, createdLabel: dateLabel(job.createdAt), itemCount: job._count.items,
      }))} />
      {jobPages > 1 && <nav aria-label="导入任务分页" className="mt-3 flex items-center justify-center gap-3">
        {jobPage > 1 && <Link href={href({ jobsPage: jobPage - 1 })} className={pageButton}>上一页</Link>}
        <span className="text-xs text-gray-500">第 {jobPage} / {jobPages} 页</span>
        {jobPage < jobPages && <Link href={href({ jobsPage: jobPage + 1 })} className={pageButton}>下一页</Link>}
      </nav>}
    </section>

    <section id="drafts" className="mt-5 scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="drafts-heading">
      <h2 id="drafts-heading" className="font-bold text-gray-800">私有待审区</h2>
      <p className="mt-2 text-xs leading-5 text-gray-500">{assignmentReady ? "列表仅显示编号、来源、状态和负责人。同意初审后分配给团队成员，成员补充并提交后由管理员终审，终审通过才会发布。" : "列表仅显示编号和来源。打开审查页后可查看、修改内容和选择照片，审核通过后再发布。"}</p>
      <nav aria-label="草稿状态" className="my-4 flex flex-wrap gap-2">
        {statusOptions.map(([value, label]) => <Link
          key={value} href={href({ status: value, page: 1 })} aria-current={status === value ? "page" : undefined}
          className={`rounded-full px-3 py-2 text-sm ${status === value ? "bg-pink-500 text-white" : "bg-gray-100 text-gray-600"}`}>{label}</Link>)}
      </nav>
      <p className="text-xs text-gray-500">当前状态共 {total} 条，每页 {pageSize} 条。</p>
      <DraftList key={`${status}:${page}:${assignmentReady}`} drafts={drafts.map(draft => ({
        id: draft.id, version: draft.version, status: draft.status,
        sourceName: draft.post.source.name, createdLabel: dateLabel(draft.createdAt), teamUsername: assignmentReady ? draft.assignedAccount?.username ?? null : null,
      }))} teamAccounts={teamAccounts} assignmentReady={assignmentReady} emptyLabel={`当前没有${status === "pending" ? assignmentReady ? "待初审的" : "待审查的" : "此状态的"}草稿。`} />
      {totalPages > 1 && <nav aria-label="草稿分页" className="mt-3 flex items-center justify-center gap-3">
        {page > 1 && <Link href={href({ page: page - 1 })} className={pageButton}>上一页</Link>}
        <span className="text-xs text-gray-500">第 {page} / {totalPages} 页</span>
        {page < totalPages && <Link href={href({ page: page + 1 })} className={pageButton}>下一页</Link>}
      </nav>}
    </section>
  </main>;
}