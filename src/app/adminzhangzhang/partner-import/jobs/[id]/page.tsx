import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getImportProgress, PartnerImportError } from "@/lib/partner-import";
import { JobRunner } from "../../JobRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 240;
export const metadata: Metadata = { title: "导入任务", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PartnerImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) notFound();
  const job = await prisma.partnerImportJob.findUnique({
    where: { id }, select: { id: true, createdAt: true, source: { select: { name: true } } },
  });
  if (!job) notFound();
  const initialProgress = await getImportProgress(id).catch((error: unknown) => {
    // Another administrator may delete the history record between these reads.
    if (error instanceof PartnerImportError && error.message === "导入任务不存在。") notFound();
    throw error;
  });

  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
    <header className="-mx-4 mb-5 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow">
      <Link href="/adminzhangzhang/partner-import" className="text-sm text-white/90">← 导入管理</Link>
      <h1 className="font-bold">导入任务</h1>
    </header>
    <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="break-words font-bold text-gray-800">{job.source.name}</h2>
      <p className="mt-2 break-all text-xs text-gray-500">任务编号：{job.id}</p>
      <p className="mt-1 text-xs text-gray-500">建立于 {job.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
    </div>
    <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <a href={"/adminzhangzhang/partner-import/transfer?job=" + encodeURIComponent(job.id)} className="inline-block rounded-lg border border-pink-200 px-4 py-2 text-sm font-bold text-pink-600">下载中转文件 →</a>
      <p className="mt-2 text-xs leading-5 text-gray-500">完成本地导入后下载，再到正式站“上传本地中转文件”。仅导出本任务中仍待初审的草稿及照片；下载后请妥善保管。</p>
    </section>
    <JobRunner key={job.id} jobId={job.id} initialProgress={initialProgress} />
  </main>;
}