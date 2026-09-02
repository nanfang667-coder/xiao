// 支付页：支付结果只能由已验签的平台回调确认，用户端只能刷新状态。

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";
import { payMethodLabel } from "@/lib/membership";
import {
  ALLEY_POST_PRODUCT_TYPE,
  MEMBERSHIP_PRODUCT_TYPE,
  TEACHER_POST_PRODUCT_TYPE,
  paidOrderDestination,
} from "@/lib/payment-products";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user-auth";
import { refreshPaymentStatus } from "../../actions";

function safePaymentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ check?: string }>;
}) {
  if (!PAYMENT_FEATURE_ENABLED) notFound();

  const { id } = await params;
  const { check } = await searchParams;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== user.id) notFound();

  const successDestination = paidOrderDestination(
    order.productType,
    order.alleyPostId,
    order.teacherPostId,
  );
  if (!successDestination) notFound();
  if (order.status === "paid") redirect(successDestination);

  const backPath =
    order.productType === MEMBERSHIP_PRODUCT_TYPE
      ? "/vip"
      : order.productType === ALLEY_POST_PRODUCT_TYPE && order.alleyPostId
        ? `/alley/${order.alleyPostId}`
        : order.productType === TEACHER_POST_PRODUCT_TYPE && order.teacherPostId
          ? `/listing/${order.teacherPostId}`
          : "/";
  const paymentUrl = safePaymentUrl(order.paymentUrl);
  const refresh = refreshPaymentStatus.bind(null, order.id);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-4 text-white shadow-md">
        <Link href={backPath} className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">订单支付</h1>
      </header>

      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-500">商品</span>
            <span className="text-right font-medium text-gray-800">
              {order.plan}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-gray-500">支付方式</span>
            <span className="font-medium text-gray-800">
              {payMethodLabel(order.payMethod)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
            <span className="text-gray-500">应付金额</span>
            <span className="text-xl font-bold text-rose-500">
              ¥{order.amount}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
            <div className="text-gray-400">
              <div className="text-4xl">📷</div>
              <p className="mt-2 text-xs">等待支付平台确认</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            支付结果由平台签名通知确认，页面操作不会直接发放权益
          </p>
          {paymentUrl && (
            <a
              href={paymentUrl}
              className="mt-4 inline-block rounded-full border border-orange-300 px-5 py-2 text-sm font-medium text-orange-600"
            >
              返回{payMethodLabel(order.payMethod)}收银台
            </a>
          )}
        </div>
      </div>

      {check === "failed" && (
        <div className="mx-4 mt-4 rounded-xl bg-red-50 px-4 py-3 text-center text-xs text-red-600">
          暂时无法确认支付结果，请稍后重试；系统不会在未确认时发放权益。
        </div>
      )}
      {check === "pending" && (
        <div className="mx-4 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-700">
          平台显示尚未支付成功，请完成支付后再查询。
        </div>
      )}

      <div className="px-4 pt-6">
        <form action={refresh}>
          <button
            type="submit"
            className="w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-center text-base font-bold text-white shadow active:opacity-90"
          >
            查询支付结果
          </button>
        </form>
        <Link
          href={backPath}
          className="mt-3 block text-center text-xs text-gray-400"
        >
          取消，返回
        </Link>
        <p className="mt-4 text-center text-xs text-gray-500">
          遇到支付问题，请联系邮箱
          <a href="mailto:fenglou176@gmail.com" className="ml-1 text-pink-500">
            fenglou176@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
}
