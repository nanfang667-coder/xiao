import Link from "next/link";
import { isImage } from "@/lib/photo";
import type { TeacherCardItem } from "@/lib/teachers";

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function TeacherCard({ teacher }: { teacher: TeacherCardItem }) {
  const photoAlt = `${teacher.city}${teacher.district}${teacher.name}的公开照片`;

  return (
    <Link
      href={`/teacher/${teacher.id}`}
      className="flex overflow-hidden rounded-2xl bg-white shadow-sm active:scale-[0.99] transition"
    >
      {isImage(teacher.photos[0]) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={teacher.photos[0]}
          alt={photoAlt}
          className="h-24 w-24 flex-none object-cover"
        />
      ) : (
        <div
          className={`flex h-24 w-24 flex-none items-center justify-center bg-gradient-to-br text-4xl ${teacher.photos[0] ?? "from-pink-200 to-rose-300"}`}
          aria-hidden="true"
        >
          {teacher.emoji}
        </div>
      )}

      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          <span className="text-xs text-gray-400">
            📍 {teacher.city} · {teacher.district}
          </span>
          {teacher.address && (
            <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{teacher.address}</p>
          )}
          <h2 className="mt-1 line-clamp-1 text-sm font-semibold text-gray-800">
            {teacher.name}
            {teacher.age != null && (
              <span className="ml-2 text-xs font-normal text-gray-400">年龄{teacher.age}</span>
            )}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">{teacher.services}</p>
          <p className="mt-1 text-xs text-gray-400">发布于 {formatDate(teacher.createdAt)}</p>
        </div>
        <div className="text-sm font-bold text-rose-500">{teacher.price}</div>
      </div>
    </Link>
  );
}
