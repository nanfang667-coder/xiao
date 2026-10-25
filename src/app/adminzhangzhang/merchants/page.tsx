import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getMerchantsForAdmin } from "@/lib/merchants";
import { filterMerchantsForAdmin, parseAdminMerchantFilters } from "@/lib/admin-merchant-filters";
import { isImage } from "@/lib/photo";
import { formatLocationLabel } from "@/lib/location-label";
import { DeleteMerchantButton } from "./DeleteMerchantButton";
import { AdminMerchantFilters } from "./AdminMerchantFilters";
import { MerchantVisibilityButton } from "./MerchantVisibilityButton";

export default async function AdminMerchantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const filters = parseAdminMerchantFilters(await searchParams);
  const result = filterMerchantsForAdmin(await getMerchantsForAdmin(), filters);
  const merchants = result.merchants;

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/adminzhangzhang" className="text-white/90">← 返回</Link>
        <h1 className="text-lg font-bold">商家管理</h1>
      </header>

      <Link href="/adminzhangzhang/merchants/new" className="mb-4 flex items-center justify-center rounded-xl bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600">
        ＋ 添加商家
      </Link>

      <AdminMerchantFilters
        {...filters}
        total={result.total}
        allLocationTotal={result.allLocationTotal}
        provinceCounts={result.provinceCounts}
        cityCounts={result.cityCounts}
      />

      <div className="mt-4 space-y-3">
        {merchants.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            {filters.province ? "没有符合条件的商家" : "还没有商家"}
          </p>
        )}
        {merchants.map((merchant) => (
          <div key={merchant.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
            {merchant.photos[0] && isImage(merchant.photos[0]) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={merchant.photos[0]} alt={merchant.name} className="h-14 w-14 flex-none rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-orange-200 text-2xl">🏪</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400">#{merchant.id}</span>
                <span className="rounded-full bg-pink-50 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">排序 {merchant.sortOrder}</span>
                {!merchant.isPublished && (
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">已隐藏</span>
                )}
              </div>
              <h2 className="mt-1 truncate text-sm font-semibold text-gray-800">{merchant.name || `商家 #${merchant.id}`}</h2>
              <p className="mt-1 text-xs text-sky-600">阅读量 {merchant.viewCount.toLocaleString("zh-CN")} 次</p>
              <p className="truncate text-xs text-gray-400">
                {[formatLocationLabel(merchant.city, merchant.district), merchant.price].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-none flex-col items-end gap-2">
              <MerchantVisibilityButton id={merchant.id} isPublished={merchant.isPublished} />
              <div className="flex gap-2">
                <Link href={`/adminzhangzhang/merchants/${merchant.id}/edit`} className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50">
                  编辑
                </Link>
                <DeleteMerchantButton id={merchant.id} name={merchant.name || `商家 #${merchant.id}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
