import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPartnerLinksForAdmin } from "@/lib/partner-links";
import { DeletePartnerButton } from "./DeletePartnerButton";

function getHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export default async function AdminPartnersPage() {
  await requireAdmin();
  const partners = await getPartnerLinksForAdmin();

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="text-lg font-bold">合作伙伴管理</h1>
      </header>

      <Link href="/adminzhangzhang/partners/new" className="mb-4 flex items-center justify-center rounded-xl bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600">
        ＋ 添加合作伙伴
      </Link>

      <div className="space-y-3">
        {partners.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">还没有合作伙伴</p>
        )}
        {partners.map((partner) => (
          <div key={partner.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-pink-50 text-xl">🔗</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gray-400">#{partner.id}</span>
                <span className="rounded-full bg-pink-50 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">排序 {partner.sortOrder}</span>
                <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                  {partner.linkType === "sponsored" ? "付费推广" : "友情链接"}
                </span>
                {!partner.isPublished && (
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">未公开</span>
                )}
              </div>
              <h2 className="mt-1 truncate text-sm font-semibold text-gray-800">{partner.name}</h2>
              <p className="truncate text-xs text-gray-400">{getHostname(partner.url)}</p>
              {partner.description && <p className="mt-0.5 truncate text-xs text-gray-400">{partner.description}</p>}
            </div>
            <div className="flex flex-none gap-2">
              <Link href={`/adminzhangzhang/partners/${partner.id}/edit`} className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50">
                编辑
              </Link>
              <DeletePartnerButton id={partner.id} name={partner.name} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
