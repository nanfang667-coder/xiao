// 首页（server 组件）：负责从数据库读取老师，再交给下面的组件展示。
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getActiveNationalPromotions,
  getAvailableSeoLocationSlugs,
  getHomeTeachers,
} from "@/lib/teachers";
import { getCurrentUser } from "@/lib/user-auth";
import {
  getSeoLocationFromSelection,
  getSeoLocationPath,
} from "@/lib/location-seo";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";
import { getPublishedPartnerLinks } from "@/lib/partner-links";
import {
  ALLEY_PUBLIC_ENABLED,
  PAYMENT_FEATURE_ENABLED,
} from "@/lib/feature-flags";
import { TeacherBrowser } from "./TeacherBrowser";

type HomeProps = {
  searchParams: Promise<{
    province?: string | string[];
    city?: string | string[];
    page?: string | string[];
  }>;
};

const PAGE_SIZE = 10;

export async function generateMetadata(): Promise<Metadata> {
  const site = await getCurrentSite();
  return {
    title: { absolute: `${site.name}｜全国地区信息` },
    description: `${site.name}汇集全国各城市公开的地区信息，可按地区查看个人介绍、价格和详细内容。`,
    alternates: { canonical: siteOrigin(site) },
  };
}

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

  const rawPage = Number(firstValue(query.page));
  const requestedPage =
    Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  // 旧地区筛选地址永久迁移到可收录的品牌地区页。
  if (province) {
    const location = getSeoLocationFromSelection(province, city || undefined);
    if (!location) notFound();

    const availableLocationSlugs = await getAvailableSeoLocationSlugs();
    if (!availableLocationSlugs.has(location.slug)) notFound();

    const path = getSeoLocationPath(location);
    permanentRedirect(
      requestedPage > 1 ? `${path}?page=${requestedPage}` : path,
    );
  }

  const now = new Date();
  // 首页列表在数据库中分页，只把当前10条公开卡片发送到浏览器。
  const [
    result,
    nationalPromotions,
    partnerLinks,
    availableLocationSlugs,
    user,
    site,
  ] = await Promise.all([
    getHomeTeachers(requestedPage, PAGE_SIZE, now),
    getActiveNationalPromotions(now),
    getPublishedPartnerLinks(),
    getAvailableSeoLocationSlugs(),
    getCurrentUser(),
    getCurrentSite(),
  ]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: site.name,
            url: siteOrigin(site),
          }),
        }}
      />
      <TeacherBrowser
        teachers={result.teachers}
        nationalPromotions={nationalPromotions}
        partnerLinks={partnerLinks}
        user={user}
        availableLocationSlugs={[...availableLocationSlugs]}
        page={result.page}
        totalPages={result.totalPages}
        alleyPublicEnabled={ALLEY_PUBLIC_ENABLED}
        paymentEnabled={PAYMENT_FEATURE_ENABLED}
        siteName={site.name}
      />
    </>
  );
}
