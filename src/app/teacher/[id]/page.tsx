import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTeacherContactById,
  getTeacherPublicById,
  getTeacherSeoById,
} from "@/lib/teachers";
import { formatLocationLabel } from "@/lib/location-label";
import {
  getSeoLocationPath,
  getSeoLocationUrl,
  getSeoLocationsForRecord,
} from "@/lib/location-seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { Gallery } from "./Gallery";
import { SafetyNotice } from "./SafetyNotice";
import { BackButton } from "./BackButton";
import { TeacherViewTracker } from "./TeacherViewTracker";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember, MEMBERSHIP_PLAN } from "@/lib/membership";
import { PAYMENT_FEATURE_ENABLED } from "@/lib/feature-flags";

type TeacherPageProps = {
  params: Promise<{ id: string }>;
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: TeacherPageProps): Promise<Metadata> {
  const { id } = await params;
  const teacher = await getTeacherSeoById(id);

  if (!teacher) {
    return {
      title: "信息不存在",
      robots: { index: false, follow: false },
    };
  }

  const name = compactText(teacher.name) || `资料 ${teacher.id}`;
  const location = formatLocationLabel(teacher.city, teacher.district);
  const intro = compactText(teacher.services);
  const title = `${truncate(`${name}｜${location ? `${location}地区信息` : "详细信息"}`, 54)} | ${SITE_NAME}`;
  const description = truncate(
    `${name}的${location ? `${location}地区信息` : "公开信息"}。${intro || "查看个人介绍、价格及相关信息。"}`,
    160,
  );
  const canonical = `${SITE_URL}/listing/${teacher.id}`;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "profile",
    },
  };
}

export default async function TeacherDetail({ params }: TeacherPageProps) {
  const { id } = await params;
  const [teacher, user] = await Promise.all([
    getTeacherPublicById(id),
    getCurrentUser(),
  ]);

  if (!teacher) notFound();

  const canViewContact = !PAYMENT_FEATURE_ENABLED || isActiveMember(user);
  const contact = canViewContact ? await getTeacherContactById(id) : null;
  if (canViewContact && !contact) notFound();

  const location = formatLocationLabel(teacher.city, teacher.district);
  const seoLocations = getSeoLocationsForRecord(teacher.city, teacher.district);
  const mostSpecificLocation = seoLocations.at(-1);
  const breadcrumbItems = [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
    ...seoLocations.map((location, index) => ({
      "@type": "ListItem",
      position: index + 2,
      name: `${location.name}凤楼`,
      item: getSeoLocationUrl(location, SITE_URL),
    })),
    {
      "@type": "ListItem",
      position: seoLocations.length + 2,
      name: teacher.name,
      item: `${SITE_URL}/listing/${teacher.id}`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <TeacherViewTracker teacherId={Number(teacher.id)} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: breadcrumbItems,
          }),
        }}
      />
      {/* 安全提示弹窗 */}
      <SafetyNotice />

      {/* 顶部返回栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <BackButton />
      </header>

      <nav
        aria-label="面包屑"
        className="flex flex-wrap items-center gap-1 bg-white px-4 py-2 text-xs text-gray-500"
      >
        <Link href="/" className="hover:text-pink-500">
          首页
        </Link>
        {seoLocations.map((location) => (
          <span key={location.slug} className="flex items-center gap-1">
            <span aria-hidden="true">›</span>
            <Link
              href={getSeoLocationPath(location)}
              className="hover:text-pink-500"
            >
              {location.name}凤楼
            </Link>
          </span>
        ))}
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="line-clamp-1">
          {teacher.name}
        </span>
      </nav>

      {/* 多张照片：可左右滑动浏览 */}
      <Gallery
        photos={teacher.photos}
        emoji={teacher.emoji}
        alt={`${teacher.city}${teacher.district}${teacher.name}的公开照片`}
      />

      <div className="px-4">
        {/* 标题区 */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          {location && (
            <div className="text-xs text-gray-400">📍 {location}</div>
          )}
          {mostSpecificLocation && (
            <Link
              href={getSeoLocationPath(mostSpecificLocation)}
              className="mt-1 inline-block text-xs text-pink-500"
            >
              查看{mostSpecificLocation.name}凤楼
            </Link>
          )}
          <h1 className="mt-2 text-lg font-bold text-gray-900">
            {teacher.name}
            {teacher.age != null && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                年龄{teacher.age}
              </span>
            )}
          </h1>
          <div className="mt-2 text-xl font-bold text-rose-500">
            {teacher.price}
          </div>
        </div>

        {/* 服务内容 */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-800">服务内容</h2>
          <p className="text-sm leading-6 text-gray-600">{teacher.services}</p>
        </section>

        {/* 补充说明（有内容才显示） */}
        {teacher.courseNotes && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">补充说明</h2>
            <p className="whitespace-pre-line text-sm leading-6 text-gray-600">
              {teacher.courseNotes}
            </p>
          </section>
        )}

        {/* 风险提示 */}
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          本平台为信息分享平台，不对经历负责，凡是要求定金、视频验证、提前付费等行为可能是骗子，同时也注意任何形式的办卡行为。
        </div>

        {/* 详细地址 */}
        {teacher.address && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">详细地址</h2>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="font-medium">{teacher.address}</span>
            </div>
          </section>
        )}

        {/* 联系方式：有效会员显示真实信息，其他用户显示软付费墙。 */}
        {contact ? (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-gray-800">联系方式</h2>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">电话</span>
                <span className="font-medium">{contact.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">微信</span>
                <span className="font-medium">{contact.wechat}</span>
              </div>
              {contact.qq && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-gray-400">QQ</span>
                  <span className="font-medium">{contact.qq}</span>
                </div>
              )}
              {contact.other && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-gray-400">其他</span>
                  <span className="font-medium">{contact.other}</span>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="mt-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100"
                aria-hidden="true"
              >
                🔒
              </span>
              <div>
                <h2 className="text-sm font-bold text-gray-800">
                  联系方式 · 会员专享
                </h2>
                <p className="mt-0.5 text-xs text-gray-400">
                  开通后查看电话、微信、QQ 等信息
                </p>
              </div>
            </div>

            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-800">
              用户新增过多，现在改为付费会员模式，会员费用将用于网站日常维护和信息持续更新，感谢您的支持。
            </p>

            <div className="mt-4 space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
              {[
                ["电话", "会员开通后查看"],
                ["微信", "会员开通后查看"],
                ["QQ / 其他", "会员开通后查看"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-400">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {MEMBERSHIP_PLAN.name}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
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

            {user ? (
              <Link
                href="/vip"
                className="mt-4 block w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-center text-sm font-bold text-white shadow active:opacity-90"
              >
                立即开通永久会员
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="mt-4 block w-full rounded-full bg-pink-500 py-3 text-center text-sm font-bold text-white active:bg-pink-600"
                >
                  登录后开通会员
                </Link>
                <p className="mt-3 text-center text-xs text-gray-500">
                  还没有账号？
                  <Link href="/register" className="ml-1 text-pink-500">
                    立即注册
                  </Link>
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
