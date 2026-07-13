import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getLfgList } from "@/lib/lfg-api";
import { prisma } from "@/lib/prisma";
import { BulkImportList } from "./BulkImportList";

export default async function ApiImportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; imported?: string; skipped?: string; failed?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  let error = "";
  let data: Awaited<ReturnType<typeof getLfgList>> | null = null;
  try { data = await getLfgList(page); } catch (cause) { error = cause instanceof Error ? cause.message : "读取 API 数据失败"; }
  const cids = data?.list.map((item) => item.cid) ?? [];
  const imported = cids.length ? await prisma.teacher.findMany({ where: { source: "lfgapi", sourceId: { in: cids } }, select: { id: true, sourceId: true } }) : [];
  const importedByCid = Object.fromEntries(
    imported.filter((item) => item.sourceId != null).map((item) => [String(item.sourceId), item.id]),
  );
  const importedCount = Math.max(0, Number(params.imported) || 0);
  const skippedCount = Math.max(0, Number(params.skipped) || 0);
  const failedCount = Math.max(0, Number(params.failed) || 0);

  return <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
      <Link href="/admin/teachers" className="text-white/90">← 返回</Link><h1 className="text-lg font-bold">API 数据导入</h1>
    </header>
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">列表查询免费。只有点击“导入（2 金币）”才会读取收费详情；已导入的 cid 不会再次请求详情。</div>
    {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>}
    {(importedCount > 0 || skippedCount > 0 || failedCount > 0) && (
      <div className={`mb-4 rounded-xl p-3 text-sm ${failedCount > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>
        导入完成：成功 {importedCount} 条，跳过已导入 {skippedCount} 条，失败 {failedCount} 条。
      </div>
    )}
    {data && <BulkImportList items={data.list} importedByCid={importedByCid} page={page} />}
    {data && <nav className="mt-6 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={`/admin/import?page=${page - 1}`} className="text-pink-600">上一页</Link> : <span />}
      <span className="text-gray-400">{page} / {data.total_page}</span>
      {page < data.total_page ? <Link href={`/admin/import?page=${page + 1}`} className="text-pink-600">下一页</Link> : <span />}
    </nav>}
  </div>;
}
