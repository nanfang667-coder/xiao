// 支付页：显示订单金额、收款码（占位）、我已完成支付。
// ⚠️ 未来接入真实支付：把这里的「收款码占位」换成支付宝/微信下单返回的二维码，
//    并把「我已完成支付」按钮换成由支付回调自动触发 confirmPayment。

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user-auth";
import { payMethodLabel } from "@/lib/membership";
import { confirmPayment } from "../../actions";

export default async function PayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orderId = Number(id);
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // 订单不存在或不属于当前用户
  if (!order || order.userId !== user.id) notFound();
  // 已支付则直接回 VIP 页
  if (order.status === "paid") redirect("/vip?paid=1");

  // 把订单 id 预绑定到确认支付操作上
  const confirm = confirmPayment.bind(null, order.id);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-4 text-white shadow-md">
        <Link href="/vip" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">订单支付</h1>
      </header>

      {/* 订单信息 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">商品</span>
            <span className="font-medium text-gray-800">{order.plan}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-gray-500">支付方式</span>
            <span className="font-medium text-gray-800">
              {payMethodLabel(order.payMethod)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
            <span className="text-gray-500">应付金额</span>
            <span className="text-xl font-bold text-rose-500">¥{order.amount}</span>
          </div>
        </div>
      </div>

      {/* 收款码占位 */}
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
            <div className="text-gray-400">
              <div className="text-4xl">📷</div>
              <p className="mt-2 text-xs">收款码（对接支付后显示）</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            请使用{payMethodLabel(order.payMethod)}扫码支付
          </p>
        </div>
      </div>

      {/* 我已完成支付 */}
      <div className="px-4 pt-6">
        <form action={confirm}>
          <button
            type="submit"
            className="w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-base font-bold text-white shadow active:opacity-90"
          >
            我已完成支付
          </button>
        </form>
        <Link
          href="/vip"
          className="mt-3 block text-center text-xs text-gray-400"
        >
          取消，返回
        </Link>
      </div>
    </div>
  );
}
