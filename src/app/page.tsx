// 首页（server 组件）：负责从数据库读取老师，再交给下面的组件展示。
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { parsePage, pageUrl } from "@/lib/pagination";
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
import { TeacherBrowser } from "./TeacherBrowser";

type HomeProps = {
  searchParams: Promise<{
    province?: string | string[];
    city?: string | string[];
    page?: string | string[];
  }>;
};

const PAGE_SIZE = 10;

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const [site, query] = await Promise.all([getCurrentSite(), searchParams]);
  const page = parsePage(query.page);
  const pageLabel = page > 1 ? ` - 第${page}页` : "";
  return {
    title: { absolute: `${site.name}｜全国地区信息${pageLabel}` },
    description: `${site.name}汇集全国各城市公开的地区信息，可按地区查看个人介绍、价格和详细内容。`,
    alternates: { canonical: new URL(pageUrl("/", page), siteOrigin(site)).toString() },
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

  const requestedPage = parsePage(query.page);
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
    availableLocationSlugs,
    user,
    site,
  ] = await Promise.all([
    getHomeTeachers(requestedPage, PAGE_SIZE, now),
    getActiveNationalPromotions(now),
    getAvailableSeoLocationSlugs(),
    getCurrentUser(),
    getCurrentSite(),
  ]);
  if (requestedPage !== result.page) redirect(pageUrl("/", result.page));

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
        user={user}
        availableLocationSlugs={[...availableLocationSlugs]}
        page={result.page}
        totalPages={result.totalPages}
        siteName={site.name}
      />
    </>
  );
}
