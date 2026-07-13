import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getLfgList } from "@/lib/lfg-api";
import { prisma } from "@/lib/prisma";
import { importLfgTeacher } from "./actions";

export default async function ApiImportPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const rawPage = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  let error = "";
  let data: Awaited<ReturnType<typeof getLfgList>> | null = null;
  try { data = await getLfgList(page); } catch (cause) { error = cause instanceof Error ? cause.message : "读取 API 数据失败"; }
  const cids = data?.list.map((item) => item.cid) ?? [];
  const imported = cids.length ? await prisma.teacher.findMany({ where: { source: "lfgapi", sourceId: { in: cids } }, select: { id: true, sourceId: true } }) : [];
  const importedByCid = new Map(imported.map((item) => [item.sourceId, item.id]));

  return <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
      <Link href="/admin/teachers" className="text-white/90">← 返回</Link><h1 className="text-lg font-bold">API 数据导入</h1>
    </header>
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">列表查询免费。只有点击“导入（2 金币）”才会读取收费详情；已导入的 cid 不会再次请求详情。</div>
    {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>}
    <div className="space-y-3">{data?.list.map((item) => {
      const localId = importedByCid.get(item.cid);
      return <div key={item.cid} className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex gap-3">
        <div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-semibold text-gray-800">{item.title}</h2><p className="mt-1 text-xs text-gray-400">cid {item.cid} · 地区 {item.shi_id}</p></div>
        {localId ? <Link href={`/admin/${localId}/edit`} className="self-center rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">已导入</Link> : <form action={importLfgTeacher} className="self-center"><input type="hidden" name="cid" value={item.cid} /><button className="rounded-lg bg-pink-500 px-3 py-2 text-xs font-bold text-white">导入（2 金币）</button></form>}
      </div></div>;
    })}</div>
    {data && <nav className="mt-6 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={`/admin/import?page=${page - 1}`} className="text-pink-600">上一页</Link> : <span />}
      <span className="text-gray-400">{page} / {data.total_page}</span>
      {page < data.total_page ? <Link href={`/admin/import?page=${page + 1}`} className="text-pink-600">下一页</Link> : <span />}
    </nav>}
  </div>;
}
