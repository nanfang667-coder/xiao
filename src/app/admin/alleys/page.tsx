// 后台：小巷子信息管理模块（列表 + 添加/编辑/删除入口）

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAllAlleys } from "@/lib/alleys";
import { isImage } from "@/lib/photo";
import { DeleteAlleyButton } from "../DeleteAlleyButton";

export default async function AdminAlleysPage() {
  await requireAdmin();
  const alleys = await getAllAlleys();

  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/admin" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">小巷子管理</h1>
      </header>

      {/* 添加按钮 */}
      <Link
        href="/admin/alley/new"
        className="mb-4 flex items-center justify-center gap-1 rounded-xl bg-pink-500 py-2.5 text-sm font-bold text-white active:bg-pink-600"
      >
        ＋ 添加小巷子信息
      </Link>

      <p className="mb-2 text-xs text-gray-400">共 {alleys.length} 条信息</p>

      {/* 信息列表 */}
      <div className="space-y-3">
        {alleys.length === 0 && (
          <p className="py-16 text-center text-sm text-gray-400">
            还没有小巷子信息
          </p>
        )}
        {alleys.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
          >
            {/* 缩略图：真实图片 or 占位色块 */}
            {isImage(a.photos[0]) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.photos[0]}
                alt={a.title}
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
            ) : (
              <div
                className={`flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-gradient-to-br text-2xl ${a.photos[0]}`}
              >
                🏠
              </div>
            )}

            {/* 文字 */}
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-1 text-sm font-semibold text-gray-800">
                {a.title}
              </h2>
              <p className="text-xs text-gray-400">
                {a.city} · {a.district} · {a.price}
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-none gap-2">
              <Link
                href={`/admin/alley/${a.id}/edit`}
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50"
              >
                编辑
              </Link>
              <DeleteAlleyButton id={Number(a.id)} title={a.title} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
