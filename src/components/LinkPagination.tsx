import Link from "next/link";

function pageHref(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}
export function LinkPagination({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let value = start; value <= end; value += 1) pages.push(value);

  const buttonClass =
    "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm transition";

  return (
    <nav aria-label="分页" className="flex items-center justify-center gap-1.5 py-6">
      {page > 1 ? (
        <Link
          href={pageHref(basePath, page - 1)}
          rel="prev"
          className={`${buttonClass} border border-gray-200 text-gray-600 active:bg-gray-50`}
        >
          ‹
        </Link>
      ) : (
        <span className={`${buttonClass} border border-gray-200 text-gray-300`}>‹</span>
      )}

      {start > 1 && (
        <>
          <Link href={pageHref(basePath, 1)} className={`${buttonClass} text-gray-600`}>
            1
          </Link>
          {start > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}

      {pages.map((value) => (
        <Link
          key={value}
          href={pageHref(basePath, value)}
          aria-current={value === page ? "page" : undefined}
          className={`${buttonClass} ${
            value === page ? "bg-pink-500 font-bold text-white" : "text-gray-600"
          }`}
        >
          {value}
        </Link>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          <Link
            href={pageHref(basePath, totalPages)}
            className={`${buttonClass} text-gray-600`}
          >
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages ? (
        <Link
          href={pageHref(basePath, page + 1)}
          rel="next"
          className={`${buttonClass} border border-gray-200 text-gray-600 active:bg-gray-50`}
        >
          ›
        </Link>
      ) : (
        <span className={`${buttonClass} border border-gray-200 text-gray-300`}>›</span>
      )}
    </nav>
  );
}
