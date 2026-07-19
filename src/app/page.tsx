// 首页（server 组件）：负责从数据库读取老师，再交给下面的组件展示。
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getAvailableSeoLocationSlugs, getTeachersForList } from "@/lib/teachers";
import { getCurrentUser } from "@/lib/user-auth";
import { getSeoLocationFromSelection, getSeoLocationPath } from "@/lib/location-seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { TeacherBrowser } from "./TeacherBrowser";

type HomeProps = {
  searchParams: Promise<{
    province?: string | string[];
    city?: string | string[];
    page?: string | string[];
  }>;
};

export const metadata: Metadata = {
  title: { absolute: "凤楼｜全国地区信息" },
  description: "凤楼汇集全国各城市公开的地区信息，可按地区查看个人介绍、价格和详细内容。",
  alternates: { canonical: SITE_URL },
};

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default async function Home({ searchParams }: HomeProps) {
  const query = await searchParams;
  const province = firstValue(query.province).trim();
  const city = firstValue(query.city).trim();

  // 旧地区筛选地址永久迁移到可收录的品牌地区页。
  if (province) {
    const location = getSeoLocationFromSelection(province, city || undefined);
    if (!location) notFound();

    const availableLocationSlugs = await getAvailableSeoLocationSlugs();
    if (!availableLocationSlugs.has(location.slug)) notFound();

    const rawPage = Number(firstValue(query.page));
    const page = Number.isSafeInteger(rawPage) && rawPage > 1 ? rawPage : 1;
    const path = getSeoLocationPath(location);
    permanentRedirect(page > 1 ? `${path}?page=${page}` : path);
  }

  // 用不含联系方式的列表数据，避免会员专属信息随源码泄露
  const teachers = await getTeachersForList();
  const user = await getCurrentUser(); // 获取当前登录用户

  // TeacherBrowser 用 useSearchParams 读网址里的筛选参数，Next.js 要求套一层 Suspense
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            alternateName: "GP77",
            url: SITE_URL,
          }),
        }}
      />
      <Suspense>
        <TeacherBrowser teachers={teachers} user={user} />
      </Suspense>
    </>
  );
}
