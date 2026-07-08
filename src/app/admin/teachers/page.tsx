// 后台：老师管理模块（列表 + 添加/编辑/删除入口）

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAllTeachers } from "@/lib/teachers";
import { isImage } from "@/lib/photo";
import { DeleteTeacherButton } from "../DeleteTeacherButton";

export default async function AdminTeachersPage() {
  await requireAdmin();
  const teachers = await getAllTeachers();

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/admin" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">老师管理</h1>
      </header>

      {/* 添加老师按钮 */}
      <Link
        href="/admin/new"
        className="mb-4 flex items-center justify-center gap-1 rounded-xl bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
      >
        ＋ 添加老师
      </Link>

      <p className="mb-2 text-xs text-gray-400">共 {teachers.length} 位老师</p>

      {/* 老师列表 */}
      <div className="space-y-3">
        {teachers.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            还没有老师信息
          </p>
        )}
        {teachers.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
          >
            {/* 缩略图：真实图片 or 占位色块 */}
            {isImage(t.photos[0]) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.photos[0]}
                alt={t.name}
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
            ) : (
              <div
                className={`flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-gradient-to-br text-2xl ${t.photos[0]}`}
              >
                {t.emoji}
              </div>
            )}

            {/* 文字 */}
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-1 text-sm font-semibold text-gray-800">
                {t.name}
              </h2>
              <p className="text-xs text-gray-400">
                {t.city} · {t.district} · {t.price}
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-none gap-2">
              <Link
                href={`/admin/${t.id}/edit`}
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50"
              >
                编辑
              </Link>
              <DeleteTeacherButton id={Number(t.id)} name={t.name} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
