export function CompensationBadge() {
  return (
    <span className="absolute right-0 top-0 z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-bl-lg bg-red-600 px-2 py-1 text-[11px] font-bold leading-4 text-white shadow-sm">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path d="M12 3 4.5 6v5.5c0 4.2 3 7.6 7.5 9.5 4.5-1.9 7.5-5.3 7.5-9.5V6L12 3Z" />
        <path d="m8.5 12 2.3 2.3 4.7-4.6" />
      </svg>
      已交定金，支持赔付
    </span>
  );
}
