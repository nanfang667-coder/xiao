import type { Metadata } from "next";
import Link from "next/link";
import { requireTeamAccount } from "@/lib/team-auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import { parsePage, pageUrl } from "@/lib/pagination";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "分配给我的帖子", robots: { index: false, follow: false }, referrer: "no-referrer",
};
const pageSize = 20;
const path = "/team/assigned";
const statuses = ["assigned", "returned", "submitted", "published"];
const labels: Record<string, string> = {
  assigned: "待完善", returned: "退回修改", submitted: "待管理员终审", published: "已发布",
};

export default async function AssignedImportListPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireTeamAccount();
  if (!(await isPartnerImportAssignmentReady())) return <main className="mx-auto w-full max-w-3xl px-4 py-6">
    <Link href="/team" className="text-sm text-pink-600">← 合作后台</Link>
    <p role="status" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-700">团队分配功能尚未启用，请联系管理员。</p>
  </main>;
  const params = await searchParams;
  const where = { teamAccountId: account.id, status: { in: statuses } };
  const total = await prisma.partnerImportDraft.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(parsePage(params.page), totalPages);
  const drafts = await prisma.partnerImportDraft.findMany({
    where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize,
    select: { id: true, status: true, updatedAt: true, submission: { select: { reviewNote: true } } },
  });

  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/team" className="text-sm text-white/90">← 合作后台</Link>
      <h1 className="font-bold">分配给我的帖子</h1>
    </header>
    <p className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
      完善管理员分配的帖子，填写联系方式后提交终审。保存不会公开，提交后等待管理员审核。
    </p>
    <p className="mb-3 text-xs text-gray-500">共 {total} 条，每页 {pageSize} 条。</p>
    <section className="space-y-3" aria-label="分配给我的帖子列表">
      {drafts.map(draft => <article key={draft.id} className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-800">帖子 #{draft.id}</h2>
          <span className={draft.status === "returned" ? "text-xs text-red-700" : "text-xs text-gray-600"}>
            {labels[draft.status] ?? "暂不可编辑"}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">更新于 {draft.updatedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
        {draft.status === "returned" && draft.submission?.reviewNote && <p className="mt-3 break-words rounded-lg bg-red-50 p-3 text-sm text-red-700">
          退回说明：{draft.submission.reviewNote}
        </p>}
        <Link href={path + "/" + draft.id} prefetch={false}
          className="mt-3 inline-block rounded-lg border border-pink-200 px-4 py-2 text-sm font-bold text-pink-600">
          {["assigned", "returned"].includes(draft.status) ? "完善帖子" : "查看详情"}
        </Link>
      </article>)}
      {drafts.length === 0 && <p className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-gray-500">暂时没有分配给你的帖子。</p>}
    </section>
    {totalPages > 1 && <nav aria-label="分配帖子分页" className="mt-5 flex items-center justify-center gap-3">
      {page > 1 && <Link href={pageUrl(path, page - 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">上一页</Link>}
      <span className="text-xs text-gray-500">第 {page} / {totalPages} 页</span>
      {page < totalPages && <Link href={pageUrl(path, page + 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">下一页</Link>}
    </nav>}
  </main>;
}
