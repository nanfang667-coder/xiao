"use client";

import { useSearchParams } from "next/navigation";
import type { MouseEvent } from "react";

// 通用分页控件：上一页 / 页码 / 下一页。
// 链接保证 JavaScript 未加载时仍可翻页；水合完成后使用 onChange 无刷新切换。
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  const itemClass =
    "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm transition";

  const hrefForPage = (targetPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetPage === 1) {
      params.delete("page");
    } else {
      params.set("page", String(targetPage));
    }
    const query = params.toString();
    return query ? `/?${query}` : "/";
  };

  const handlePageClick = (
    event: MouseEvent<HTMLAnchorElement>,
    targetPage: number,
  ) => {
    event.preventDefault();
    onChange(targetPage);
  };

  const pageLink = (
    targetPage: number,
    label?: "上一页" | "下一页",
    key?: number,
  ) => (
    <a
      key={key}
      href={hrefForPage(targetPage)}
      onClick={(event) => handlePageClick(event, targetPage)}
      className={`${itemClass} ${
        label ? "border border-gray-200" : ""
      } text-gray-600 active:bg-gray-50`}
      aria-label={label}
    >
      {label ? (label === "上一页" ? "‹" : "›") : targetPage}
    </a>
  );

  return (
    <nav aria-label="分页导航" className="flex items-center justify-center gap-1.5 py-6">
      {page > 1 ? (
        pageLink(page - 1, "上一页")
      ) : (
        <span
          aria-disabled="true"
          aria-label="上一页"
          className={`${itemClass} border border-gray-200 text-gray-600 opacity-40`}
        >
          ‹
        </span>
      )}

      {start > 1 && (
        <>
          {pageLink(1)}
          {start > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}

      {pages.map((targetPage) =>
        targetPage === page ? (
          <span
            key={targetPage}
            aria-current="page"
            className={`${itemClass} bg-pink-500 font-bold text-white`}
          >
            {targetPage}
          </span>
        ) : (
          pageLink(targetPage, undefined, targetPage)
        ),
      )}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          {pageLink(totalPages)}
        </>
      )}

      {page < totalPages ? (
        pageLink(page + 1, "下一页")
      ) : (
        <span
          aria-disabled="true"
          aria-label="下一页"
          className={`${itemClass} border border-gray-200 text-gray-600 opacity-40`}
        >
          ›
        </span>
      )}
    </nav>
  );
}
