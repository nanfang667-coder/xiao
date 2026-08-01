import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherById, getTeacherSeoById } from "@/lib/teachers";
import { getSeoLocationPath, getSeoLocationUrl, getSeoLocationsForRecord } from "@/lib/location-seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { Gallery } from "./Gallery";
import { SafetyNotice } from "./SafetyNotice";
import { BackButton } from "./BackButton";

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

export async function generateMetadata({ params }: TeacherPageProps): Promise<Metadata> {
  const { id } = await params;
  const teacher = await getTeacherSeoById(id);

  if (!teacher) {
    return {
      title: "信息不存在",
      robots: { index: false, follow: false },
    };
  }

  const name = compactText(teacher.name) || `老师 ${teacher.id}`;
  const locationParts = [compactText(teacher.city), compactText(teacher.district)].filter(Boolean);
  const location = locationParts.join("·") || "本地";
  const intro = compactText(teacher.services);
  const title = `${truncate(`${name}｜${location}地区信息`, 54)} | ${SITE_NAME}`;
  const description = truncate(
    `${name}的${location}地区信息。${intro || "查看个人介绍、价格及相关信息。"}`,
    160,
  );
  const canonical = `${SITE_URL}/teacher/${teacher.id}`;

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
  const teacher = await getTeacherById(id); // 从数据库读取

  // 找不到这位老师，就显示 404
  if (!teacher) notFound();

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
      item: `${SITE_URL}/teacher/${teacher.id}`,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
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
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <BackButton />
      </div>

      <nav aria-label="面包屑" className="flex flex-wrap items-center gap-1 bg-white px-4 py-2 text-xs text-gray-500">
        <Link href="/" className="hover:text-pink-500">
          首页
        </Link>
        {seoLocations.map((location) => (
          <span key={location.slug} className="flex items-center gap-1">
            <span aria-hidden="true">›</span>
            <Link href={getSeoLocationPath(location)} className="hover:text-pink-500">
              {location.name}凤楼
            </Link>
          </span>
        ))}
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="line-clamp-1">{teacher.name}</span>
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
          <div className="text-xs text-gray-400">
            📍 {teacher.city} · {teacher.district}
          </div>
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
              <span className="ml-2 text-sm font-normal text-gray-400">年龄{teacher.age}</span>
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

        {/* 教学案例/课程记录（有内容才显示） */}
        {teacher.courseNotes && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">教学案例 / 课程记录</h2>
            <p className="whitespace-pre-line text-sm leading-6 text-gray-600">
              {teacher.courseNotes}
            </p>
          </section>
        )}

        {/* 风险提示（所有人可见，不限会员） */}
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          本平台为信息分享平台，不对经历负责，凡是要求定金、视频验证、提前付费等行为可能是骗子，同时也注意任何形式的办卡行为。
        </div>

        {/* 详细地址（所有人可见，不限会员） */}
        {teacher.contact.address && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">详细地址</h2>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="font-medium">{teacher.contact.address}</span>
            </div>
          </section>
        )}

        {/* 联系方式（所有访客可见） */}
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">联系方式</h2>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-gray-400">电话</span>
              <span className="font-medium">{teacher.contact.phone}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-gray-400">微信</span>
              <span className="font-medium">{teacher.contact.wechat}</span>
            </div>
            {teacher.contact.qq && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">QQ</span>
                <span className="font-medium">{teacher.contact.qq}</span>
              </div>
            )}
            {teacher.contact.other && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-gray-400">其他</span>
                <span className="font-medium">{teacher.contact.other}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
