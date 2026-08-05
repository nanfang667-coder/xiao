import Link from "next/link";
import { isImage } from "@/lib/photo";
import { formatLocationLabel } from "@/lib/location-label";
import type { TeacherCardItem } from "@/lib/teachers";

export function NationalPromotionCard({ teacher }: { teacher: TeacherCardItem }) {
  const location = formatLocationLabel(teacher.city, teacher.district);
  return (
    <section aria-label={"\u5168\u56fd\u63a8\u5e7f"} className="px-4 pt-4">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
            <span aria-hidden="true">{"\u2726"}</span>
            {"\u5168\u56fd\u63a8\u5e7f"}
          </span>
          <span className="text-xs text-gray-400">{"\u5168\u7ad9\u4f18\u5148\u5c55\u793a"}</span>
        </div>
        <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400">{"\u5e7f\u544a"}</span>
      </div>

      <Link
        href={`/listing/${teacher.id}`}
        className="group relative flex overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-rose-50 shadow-[0_8px_24px_rgba(190,120,25,0.12)] transition active:scale-[0.99]"
      >
        <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-full bg-gradient-to-bl from-amber-200/50 to-transparent" />
        {isImage(teacher.photos[0]) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={teacher.photos[0]}
            alt={`${teacher.name}\u7684\u63a8\u5e7f\u56fe\u7247`}
            className="h-28 w-28 flex-none object-cover"
          />
        ) : (
          <div
            className={`flex h-28 w-28 flex-none items-center justify-center bg-gradient-to-br text-4xl ${teacher.photos[0] ?? "from-amber-100 to-rose-200"}`}
            aria-hidden="true"
          >
            {teacher.emoji}
          </div>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col justify-between p-3.5">
          <div>
            {location && (
              <p className="truncate text-[11px] text-amber-700">
                {"\ud83d\udccd"} {location}
              </p>
            )}
            <h2 className="mt-1 line-clamp-1 text-base font-bold text-gray-900">{teacher.name}</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
              {teacher.services}
            </p>
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <span className="text-sm font-bold text-rose-500">{teacher.price}</span>
            <span className="text-xs font-medium text-amber-700 transition group-active:translate-x-0.5">
              {"\u67e5\u770b\u8be6\u60c5 \u2192"}
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}
