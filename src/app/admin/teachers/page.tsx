import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { searchTeachersForAdmin } from "@/lib/teachers";
import { isImage } from "@/lib/photo";
import { citiesOfProvince, normalizeProvince } from "@/data/locations";
import { DeleteTeacherButton } from "../DeleteTeacherButton";
import { AdminTeacherFilters } from "./AdminTeacherFilters";

const PAGE_SIZE = 30;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function pageHref(
  filters: { province: string; city: string; query: string },
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.province) params.set("province", filters.province);
  if (filters.city) params.set("city", filters.city);
  if (filters.query) params.set("q", filters.query);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/admin/teachers?${queryString}` : "/admin/teachers";
}

function Pagination({
  page,
  totalPages,
  filters,
}: {
  page: number;
  totalPages: number;
  filters: { province: string; city: string; query: string };
}) {
  if (totalPages <= 1) return null;

  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const buttonClass =
    "flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm transition";

  return (
    <nav aria-label="老师列表分页" className="flex items-center justify-center gap-1.5 py-6">
      {page > 1 ? (
        <Link
          href={pageHref(filters, page - 1)}
          className={`${buttonClass} border border-gray-200 bg-white text-gray-600`}
        >
          ‹
        </Link>
      ) : (
        <span className={`${buttonClass} border border-gray-200 text-gray-300`}>‹</span>
      )}

      {start > 1 && (
        <>
          <Link href={pageHref(filters, 1)} className={`${buttonClass} text-gray-600`}>
            1
          </Link>
          {start > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}

      {pages.map((pageNumber) => (
        <Link
          key={pageNumber}
          href={pageHref(filters, pageNumber)}
          aria-current={pageNumber === page ? "page" : undefined}
          className={`${buttonClass} ${
            pageNumber === page ? "bg-pink-500 font-bold text-white" : "text-gray-600"
          }`}
        >
          {pageNumber}
        </Link>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          <Link href={pageHref(filters, totalPages)} className={`${buttonClass} text-gray-600`}>
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages ? (
        <Link
          href={pageHref(filters, page + 1)}
          className={`${buttonClass} border border-gray-200 bg-white text-gray-600`}
        >
          ›
        </Link>
      ) : (
        <span className={`${buttonClass} border border-gray-200 text-gray-300`}>›</span>
      )}
    </nav>
  );
}

export default async function AdminTeachersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const rawProvince = firstValue(params.province).trim();
  const province = normalizeProvince(rawProvince) ?? "";
  const rawCity = firstValue(params.city).trim();
  const city = citiesOfProvince(province).includes(rawCity) ? rawCity : "";
  const query = firstValue(params.q).trim().slice(0, 100);
  const rawPage = Number(firstValue(params.page));
  const requestedPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const result = await searchTeachersForAdmin({
    province,
    city,
    query,
    page: requestedPage,
    pageSize: PAGE_SIZE,
  });
  const activeFilters = { province, city, query };
  const returnTo = pageHref(activeFilters, result.page);

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/admin" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">老师管理</h1>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link
          href="/admin/new"
          className="flex items-center justify-center rounded-xl bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
        >
          ＋ 添加老师
        </Link>
        <Link
          href="/admin/import"
          className="flex items-center justify-center rounded-xl border border-pink-200 bg-white py-2.5 text-sm font-bold text-pink-600 active:bg-pink-50"
        >
          批量导入
        </Link>
      </div>

      <AdminTeacherFilters
        {...activeFilters}
        total={result.total}
        allLocationTotal={result.allLocationTotal}
        provinceCounts={result.provinceCounts}
        cityCounts={result.cityCounts}
      />

      <p className="mb-2 mt-4 text-xs text-gray-400">
        第 {result.page} / {result.totalPages} 页，每页最多 {PAGE_SIZE} 位
      </p>

      <div className="space-y-3">
        {result.teachers.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">没有符合条件的老师信息</p>
        )}
        {result.teachers.map((teacher) => (
          <div
            key={teacher.id}
            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
          >
            {isImage(teacher.photos[0]) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={teacher.photos[0]}
                alt={teacher.name}
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
            ) : (
              <div
                className={`flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-gradient-to-br text-2xl ${teacher.photos[0] ?? "from-pink-100 to-rose-200"}`}
              >
                {teacher.emoji}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400">#{teacher.id}</span>
                <h2 className="line-clamp-1 text-sm font-semibold text-gray-800">
                  {teacher.name}
                </h2>
              </div>
              <p className="truncate text-xs text-gray-400">
                {teacher.city} · {teacher.district} · {teacher.price}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-300">
                添加于 {teacher.createdAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </p>
            </div>

            <div className="flex flex-none gap-2">
              <Link
                href={`/admin/${teacher.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50"
              >
                编辑
              </Link>
              <DeleteTeacherButton id={Number(teacher.id)} name={teacher.name} />
            </div>
          </div>
        ))}
      </div>

      <Pagination page={result.page} totalPages={result.totalPages} filters={activeFilters} />
    </div>
  );
}
