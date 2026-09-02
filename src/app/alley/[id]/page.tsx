import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlleyImagePlaceholder } from "@/components/AlleyImagePlaceholder";
import { canAccessAlleyPost } from "@/lib/alley-access";
import {
  getPublishedAlleyMemberDetailById,
  getPublishedAlleyPublicById,
} from "@/lib/alleys";
import {
  ALLEY_DIRECT_ACCESS_ENABLED,
  ALLEY_PUBLIC_ENABLED,
  PAYMENT_FEATURE_ENABLED,
} from "@/lib/feature-flags";
import { formatLocationLabel } from "@/lib/location-label";
import { MEMBERSHIP_PLAN } from "@/lib/membership";
import { ALLEY_UNLOCK_PLAN } from "@/lib/payment-products";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/user-auth";
import { AlleyUnlockPurchase } from "./AlleyUnlockPurchase";

type AlleyDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; paymentError?: string }>;
};

export async function generateMetadata({
  params,
}: AlleyDetailPageProps): Promise<Metadata> {
  if (!ALLEY_DIRECT_ACCESS_ENABLED) {
    return {
      title: "页面不存在",
      robots: { index: false, follow: false },
    };
  }

  const { id } = await params;
  const alley = await getPublishedAlleyPublicById(id);
  if (!alley)
    return { title: "暗巷信息不存在", robots: { index: false, follow: false } };

  const location = formatLocationLabel(alley.city, alley.district);
  const title = `${alley.title}｜${location || "暗巷"} | ${SITE_NAME}`;
  const canonical = `${SITE_URL}/alley/${alley.id}`;
  return {
    title: { absolute: title },
    description: `${alley.title}${alley.address ? `，地址：${alley.address}` : ""}。详细介绍和图片支持单篇解锁或会员查看。`,
    alternates: { canonical },
    openGraph: {
      title,
      url: canonical,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "article",
    },
    ...(!ALLEY_PUBLIC_ENABLED
      ? { robots: { index: false, follow: false } }
      : {}),
  };
}

export default async function AlleyDetailPage({
  params,
  searchParams,
}: AlleyDetailPageProps) {
  if (!ALLEY_DIRECT_ACCESS_ENABLED) notFound();

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [alley, user] = await Promise.all([
    getPublishedAlleyPublicById(id),
    getCurrentUser(),
  ]);
  if (!alley) notFound();

  const canViewDetail = await canAccessAlleyPost(user, alley.id);
  const memberDetail = canViewDetail
    ? await getPublishedAlleyMemberDetailById(alley.id)
    : null;
  if (canViewDetail && !memberDetail) notFound();

  const paymentErrorMessages: Record<string, string> = {
    configuration: "支付配置暂不可用，请稍后重试。",
    unavailable: "暂时无法连接支付平台，请稍后重试；本次没有扣款。",
    rejected: "支付平台拒绝了下单请求，请稍后重试。",
    invalid_response: "支付平台返回内容未通过安全校验，本次没有扣款。",
    rate: "操作过于频繁，请一分钟后再试。",
    method: "暂不支持所选支付方式。",
  };
  const location = formatLocationLabel(alley.city, alley.district);

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/alley" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">暗巷</h1>
      </header>

      <main className="px-4 pt-4">
        {query.paid === "1" && memberDetail && (
          <div className="mb-4 rounded-xl bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-600">
            🎉 支付成功，当前帖子已永久解锁！
          </div>
        )}
        {query.paymentError && paymentErrorMessages[query.paymentError] && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-600">
            {paymentErrorMessages[query.paymentError]}
          </div>
        )}

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          {location && <p className="text-xs text-gray-400">📍 {location}</p>}
          <h1 className="mt-2 text-xl font-bold text-gray-900">
            {alley.title}
          </h1>
          {alley.address && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <h2 className="text-sm font-bold text-gray-800">详细地址</h2>
              <p className="mt-2 text-sm leading-6 text-gray-700">
                {alley.address}
              </p>
            </div>
          )}
        </section>

        {memberDetail ? (
          <>

            <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-bold text-gray-900">详细介绍</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-gray-700">
                {memberDetail.description}
              </p>
            </section>

            <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-bold text-gray-900">详情图片</h2>
              <div className="mt-3 space-y-3">
                {memberDetail.detailPhotos.length > 0 ? (
                  memberDetail.detailPhotos.map((photo, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={photo}
                      src={photo}
                      alt={`${alley.title}详情图片 ${index + 1}`}
                      className="w-full rounded-xl object-cover"
                    />
                  ))
                ) : (
                  <AlleyImagePlaceholder className="aspect-video w-full rounded-xl" />
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="mt-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100"
                aria-hidden="true"
              >
                🔒
              </span>
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  详细介绍与图片 · 付费解锁
                </h2>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  可单独永久解锁当前帖子，也可开通永久会员查看全部暗巷帖子。
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-pink-200 bg-pink-50 p-3">
                <p className="text-sm font-bold text-gray-800">解锁本帖</p>
                <p className="mt-1 text-2xl font-bold text-rose-500">
                  ¥{ALLEY_UNLOCK_PLAN.price}
                </p>
                <p className="mt-1 text-xs text-gray-500">当前帖子永久有效</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-bold text-gray-800">
                  {MEMBERSHIP_PLAN.name}
                </p>
                <p className="mt-1 text-xs font-bold text-orange-500">限时价</p>
                <p className="text-2xl font-bold text-orange-500">
                  ¥{MEMBERSHIP_PLAN.price}
                </p>
                <p className="text-xs text-gray-400 line-through">
                  原价 ¥{MEMBERSHIP_PLAN.originalPrice}
                </p>
                <p className="mt-1 text-xs text-gray-500">全部帖子永久可看</p>
              </div>
            </div>

            <div className="mt-4">
              {!PAYMENT_FEATURE_ENABLED ? (
                <p className="rounded-xl bg-gray-50 px-3 py-3 text-center text-sm text-gray-500">
                  支付功能暂不可用，请稍后再试
                </p>
              ) : user ? (
                <AlleyUnlockPurchase alleyPostId={alley.id} />
              ) : (
                <Link
                  href="/login"
                  className="block w-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 py-3 text-center text-sm font-bold text-white shadow active:opacity-90"
                >
                  登录后解锁本帖
                </Link>
              )}
            </div>

            {PAYMENT_FEATURE_ENABLED && (
              <Link
                href={user ? "/vip" : "/login"}
                className="mt-3 block w-full rounded-full border border-orange-300 py-2.5 text-center text-sm font-bold text-orange-600"
              >
                {user ? "开通永久会员，查看全部帖子" : "登录后开通永久会员"}
              </Link>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
