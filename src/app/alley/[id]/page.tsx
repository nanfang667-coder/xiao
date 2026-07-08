// 小巷子信息详情页
// 标题、介绍、价格所有人可见；图片和具体位置仅会员可见。

import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlleyById } from "@/lib/alleys";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import { AlleyGallery } from "./Gallery";

export default async function AlleyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const alley = await getAlleyById(id);
  const user = await getCurrentUser();
  const isMember = isActiveMember(user); // 仅决定图片是否清晰

  if (!alley) notFound();

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部返回栏 */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <Link href="/alley" className="text-pink-500">
          ← 返回
        </Link>
      </div>

      {/* 多张照片（非会员模糊） */}
      <AlleyGallery photos={alley.photos} blurred={!isMember} />

      <div className="px-4">
        {/* 标题区 */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">{alley.title}</h1>
          <div className="mt-2 text-xl font-bold text-rose-500">
            {alley.price}
          </div>
        </div>

        {/* 介绍 */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-800">介绍</h2>
          <p className="whitespace-pre-line text-sm leading-6 text-gray-600">
            {alley.intro}
          </p>
        </section>

        {/* 具体位置（仅会员可见） */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">具体位置</h2>

          {isMember ? (
            // 已开通会员：显示真实具体位置
            <p className="text-sm text-gray-700">📍 {alley.location}</p>
          ) : (
            // 未开通会员：锁定状态
            <div className="relative overflow-hidden rounded-xl bg-gray-50 p-5 text-center">
              <div className="select-none blur-sm">
                <p className="text-sm text-gray-700">📍 ****市****区****路****号</p>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-3xl">🔒</div>
                <p className="mb-3 text-sm text-gray-500">
                  {user ? "开通会员，查看具体位置" : "请先登录后开通会员"}
                </p>
                {user ? (
                  <Link href="/vip" className="inline-block rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-2 text-sm font-bold text-white shadow">
                    开通会员
                  </Link>
                ) : (
                  <div className="space-y-2">
                    <Link href="/login" className="inline-block rounded-full bg-pink-500 px-6 py-2 text-sm font-bold text-white">
                      立即登录
                    </Link>
                    <p className="text-xs text-gray-500">还没有账号？<Link href="/register" className="text-pink-500">立即注册</Link></p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
