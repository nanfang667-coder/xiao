import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { UserStatus } from "@/components/UserStatus";
import { TeacherCard } from "@/components/TeacherCard";
import { LinkPagination } from "@/components/LinkPagination";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import {
  getAvailableSeoLocationSlugs,
  getTeachersForSeoLocation,
} from "@/lib/teachers";
import {
  FEATURED_SEO_LOCATIONS,
  getSeoLocationBySlug,
  getSeoLocationFromSelection,
  getSeoLocationPath,
  getSeoLocationUrl,
} from "@/lib/location-seo";
import {
  MIN_ACCESSIBLE_LOCATION_RECORDS,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site-config";

const PAGE_SIZE = 10;

type CityPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parsePage(value: string | string[] | undefined): number {
  const page = Number(firstValue(value));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function pageUrl(path: string, page: number): string {
  return page > 1 ? `${path}?page=${page}` : path;
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export async function generateMetadata({ params, searchParams }: CityPageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const location = getSeoLocationBySlug(slug);
  if (!location) notFound();

  const requestedPage = parsePage(query.page);
  const result = await getTeachersForSeoLocation(
    location.province,
    location.region,
    requestedPage,
    PAGE_SIZE,
  );
  if (result.total < MIN_ACCESSIBLE_LOCATION_RECORDS) notFound();

  const page = result.page;
  const path = getSeoLocationPath(location);
  const canonical = new URL(pageUrl(path, page), SITE_URL).toString();
  const pageLabel = page > 1 ? `第${page}页` : "";
  const typeNames = Object.keys(result.typeCounts)
    .map(compactText)
    .filter(Boolean)
    .slice(0, 3);
  const typeText = typeNames.length > 0 ? typeNames.join("、") : "本地";
  const title = truncate(`${location.name}凤楼${pageLabel}｜${location.name}地区信息`, 60);
  const description = truncate(
    `${SITE_NAME}${location.name}站收录${result.total}条公开信息，涵盖${typeText}等类型，可查看个人介绍、价格与所在地区。`,
    160,
  );

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "website",
    },
  };
}

export default async function CitySeoPage({ params, searchParams }: CityPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const location = getSeoLocationBySlug(slug);
  if (!location) notFound();

  const requestedPage = parsePage(query.page);
  const path = getSeoLocationPath(location);
  let decodedSlug: string;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    notFound();
  }

  const result = await getTeachersForSeoLocation(
    location.province,
    location.region,
    requestedPage,
    PAGE_SIZE,
  );
  if (result.total < MIN_ACCESSIBLE_LOCATION_RECORDS) notFound();
  if (decodedSlug.toLowerCase() !== location.slug.toLowerCase()) {
    permanentRedirect(pageUrl(path, requestedPage));
  }
  if (requestedPage !== result.page) redirect(pageUrl(path, result.page));

  const [user, availableLocationSlugs] = await Promise.all([
    getCurrentUser(),
    getAvailableSeoLocationSlugs(),
  ]);

  const parentLocation = location.region
    ? getSeoLocationFromSelection(location.province)
    : undefined;
  const breadcrumbLocations = parentLocation ? [parentLocation, location] : [location];
  const breadcrumbItems = [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
    ...breadcrumbLocations.map((item, index) => ({
      "@type": "ListItem",
      position: index + 2,
      name: `${item.name}凤楼`,
      item: getSeoLocationUrl(item, SITE_URL),
    })),
  ];
  const relatedLocations = FEATURED_SEO_LOCATIONS.filter(
    (item) => item.slug !== location.slug && availableLocationSlugs.has(item.slug),
  );

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

      <header className="sticky top-0 z-10 bg-gradient-to-r from-pink-500 to-rose-500 px-4 pb-4 pt-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            {SITE_NAME}
          </Link>
          <UserStatus username={user?.username} isMember={isActiveMember(user)} />
        </div>
      </header>

      <main>
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-1 px-4 pt-4 text-xs text-gray-500">
          <Link href="/" className="hover:text-pink-500">
            首页
          </Link>
          {breadcrumbLocations.map((item) => (
            <span key={item.slug} className="flex items-center gap-1">
              <span aria-hidden="true">›</span>
              {item.slug === location.slug ? (
                <span aria-current="page">{item.name}凤楼</span>
              ) : (
                <Link href={getSeoLocationPath(item)} className="hover:text-pink-500">
                  {item.name}凤楼
                </Link>
              )}
            </span>
          ))}
        </nav>

        <section className="px-4 pt-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">{location.name}凤楼</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {SITE_NAME}{location.name}站汇集{location.name}地区公开信息，
              可查看个人介绍、服务类型、价格与所在地区。
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-pink-50 px-3 py-1.5 text-pink-600">
                共 {result.total} 条资料
              </span>
              {Object.entries(result.typeCounts).map(([type, count]) => (
                <span key={type} className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-600">
                  {type} {count}
                </span>
              ))}
              {result.lastModified && (
                <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-600">
                  更新于 {formatDate(result.lastModified)}
                </span>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="location-items-heading" className="px-4 pt-4">
          <h2 id="location-items-heading" className="mb-3 text-base font-bold text-gray-800">
            {location.name}地区信息
          </h2>
          <div className="flex flex-col gap-3">
            {result.teachers.map((teacher) => (
              <TeacherCard key={teacher.id} teacher={teacher} />
            ))}
          </div>
        </section>

        <LinkPagination basePath={path} page={result.page} totalPages={result.totalPages} />

        {relatedLocations.length > 0 && (
          <section aria-labelledby="related-cities-heading" className="px-4 pt-2">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 id="related-cities-heading" className="text-sm font-bold text-gray-800">
                其他城市
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {relatedLocations.map((item) => (
                  <Link
                    key={item.slug}
                    href={getSeoLocationPath(item)}
                    className="rounded-xl bg-pink-50 px-3 py-2 text-center text-sm text-pink-600"
                  >
                    {item.name}凤楼
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
