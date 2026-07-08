// 会员升级页：展示永久会员套餐与权益，引导开通。
// 已是会员 / 未登录 / 可购买 三种状态。

import Link from "next/link";
import { getCurrentUser } from "@/lib/user-auth";
import { MEMBERSHIP_PLAN, isActiveMember } from "@/lib/membership";
import { VipPurchase } from "./VipPurchase";

export default async function VipPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string }>;
}) {
  const { paid } = await searchParams;
  const user = await getCurrentUser();
  const isMember = isActiveMember(user);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">VIP 会员</h1>
      </header>

      {/* 支付成功提示 */}
      {paid === "1" && (
        <div className="mx-4 mt-4 rounded-xl bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-600">
          🎉 开通成功，会员权益已生效！
        </div>
      )}

      {/* 顶部会员卡 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-white shadow-lg">
          <div className="text-3xl">👑</div>
          <div className="mt-2 text-xl font-bold">{MEMBERSHIP_PLAN.name}</div>
          <div className="mt-1 text-sm text-white/90">
            {isMember ? "您已是尊贵会员，权益已全部解锁" : "一次开通，终身畅享全部权益"}
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-sm">¥</span>
            <span className="text-4xl font-bold">{MEMBERSHIP_PLAN.price}</span>
            <span className="text-sm text-white/80">/ 永久</span>
          </div>
        </div>
      </div>

      {/* 权益列表 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">会员权益</h2>
          <ul className="space-y-2.5">
            {MEMBERSHIP_PLAN.benefits.map((b) => (
              <li key={b} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-amber-100 text-xs text-amber-600">
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 底部操作区：按状态显示 */}
      {isMember ? (
        <div className="px-4 pt-6 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <p className="text-sm text-gray-500">您已开通永久会员，尽情浏览吧～</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-pink-500 px-8 py-2.5 text-sm font-bold text-white active:bg-pink-600"
          >
            去逛逛
          </Link>
        </div>
      ) : user ? (
        // 已登录未开通：显示支付方式选择 + 立即开通
        <VipPurchase />
      ) : (
        // 未登录：引导登录
        <div className="px-4 pt-6 text-center">
          <p className="mb-4 text-sm text-gray-500">开通会员前请先登录账号</p>
          <Link
            href="/login"
            className="inline-block rounded-full bg-pink-500 px-8 py-2.5 text-sm font-bold text-white active:bg-pink-600"
          >
            立即登录
          </Link>
          <p className="mt-3 text-xs text-gray-500">
            还没有账号？
            <Link href="/register" className="text-pink-500">
              立即注册
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
