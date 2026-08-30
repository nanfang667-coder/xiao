import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPublishedAlleyMemberDetailById,
  getPublishedAlleyPublicById,
} from "@/lib/alleys";
import { formatLocationLabel } from "@/lib/location-label";
import { isActiveMember, MEMBERSHIP_PLAN } from "@/lib/membership";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/user-auth";
import { ALLEY_PUBLIC_ENABLED } from "@/lib/feature-flags";

type AlleyDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: AlleyDetailPageProps): Promise<Metadata> {
  if (!ALLEY_PUBLIC_ENABLED) {
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
    description: `${alley.title}${alley.address ? `，地址：${alley.address}` : ""}。详细介绍和图片仅会员可见。`,
    alternates: { canonical },
    openGraph: {
      title,
      url: canonical,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "article",
    },
  };
}

export default async function AlleyDetailPage({
  params,
}: AlleyDetailPageProps) {
  if (!ALLEY_PUBLIC_ENABLED) notFound();

  const { id } = await params;
  const [alley, user] = await Promise.all([
    getPublishedAlleyPublicById(id),
    getCurrentUser(),
  ]);
  if (!alley) notFound();

  const activeMember = isActiveMember(user);
  const memberDetail = activeMember
    ? await getPublishedAlleyMemberDetailById(alley.id)
    : null;
  if (activeMember && !memberDetail) notFound();

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
                {memberDetail.detailPhotos.map((photo, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={photo}
                    src={photo}
                    alt={`${alley.title}详情图片 ${index + 1}`}
                    className="w-full rounded-xl object-cover"
                  />
                ))}
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
                  详细介绍与图片 · 会员专享
                </h2>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  用户新增过多，现在改为付费会员模式，会员费用将用于网站日常维护和信息持续更新，感谢您的支持。
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-end justify-between rounded-xl bg-amber-50 p-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {MEMBERSHIP_PLAN.name}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  一次开通，永久有效
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-orange-500">限时价</p>
                <p className="text-2xl font-bold text-orange-500">
                  ¥{MEMBERSHIP_PLAN.price}
                </p>
                <p className="text-xs text-gray-400 line-through">
                  原价 ¥{MEMBERSHIP_PLAN.originalPrice}
                </p>
              </div>
            </div>

            <Link
              href={user ? "/vip" : "/login"}
              className="mt-4 block w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-center text-sm font-bold text-white shadow active:opacity-90"
            >
              {user ? "立即开通永久会员" : "登录后开通会员"}
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
