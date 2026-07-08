"use client";

// 通用分页控件：上一页 / 页码 / 下一页。
// page 从 1 开始；totalPages 为总页数；onChange 切换页码。
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  // 只有一页（或没有内容）时不显示
  if (totalPages <= 1) return null;

  // 计算要显示的页码：当前页附近最多 5 个
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm transition";

  return (
    <div className="flex items-center justify-center gap-1.5 py-6">
      {/* 上一页 */}
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className={`${btn} border border-gray-200 text-gray-600 disabled:opacity-40 active:bg-gray-50`}
      >
        ‹
      </button>

      {/* 前面省略号 */}
      {start > 1 && (
        <>
          <button onClick={() => onChange(1)} className={`${btn} text-gray-600 active:bg-gray-50`}>
            1
          </button>
          {start > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}

      {/* 页码 */}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`${btn} ${
            p === page
              ? "bg-pink-500 font-bold text-white"
              : "text-gray-600 active:bg-gray-50"
          }`}
        >
          {p}
        </button>
      ))}

      {/* 后面省略号 */}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          <button
            onClick={() => onChange(totalPages)}
            className={`${btn} text-gray-600 active:bg-gray-50`}
          >
            {totalPages}
          </button>
        </>
      )}

      {/* 下一页 */}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={`${btn} border border-gray-200 text-gray-600 disabled:opacity-40 active:bg-gray-50`}
      >
        ›
      </button>
    </div>
  );
}
