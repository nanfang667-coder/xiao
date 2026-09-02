import type { Metadata } from "next";
import Link from "next/link";
import { UserStatus } from "@/components/UserStatus";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";
import { getAvailableSeoLocationSlugs } from "@/lib/teachers";
import { getSeoLocationUrl, SEO_LOCATION_GROUPS } from "@/lib/location-seo";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getCurrentSite();
  const directoryUrl = `${siteOrigin(site)}/fenglou`;
  return {
    title: { absolute: `全国凤楼地区导航｜${site.name}` },
    description: `${site.name}全国地区导航，按省份和城市查看地区信息。`,
    alternates: { canonical: directoryUrl },
    openGraph: {
      title: `全国凤楼地区导航｜${site.name}`,
      description: `${site.name}全国地区导航，按省份和城市查看地区信息。`,
      url: directoryUrl,
      siteName: site.name,
      locale: "zh_CN",
      type: "website",
    },
  };
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default async function FenglouDirectoryPage() {
  const [user, availableLocationSlugs, site] = await Promise.all([
    getCurrentUser(),
    getAvailableSeoLocationSlugs(),
    getCurrentSite(),
  ]);
  const origin = siteOrigin(site);
  const directoryUrl = `${origin}/fenglou`;
  const availableSlugs = new Set(availableLocationSlugs);
  const availableLocations = SEO_LOCATION_GROUPS.flatMap((group) => [
    group.province,
    ...group.regions,
  ]).filter((location) => availableSlugs.has(location.slug));

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 pb-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: site.name, item: origin },
                  { "@type": "ListItem", position: 2, name: "全国地区", item: directoryUrl },
                ],
              },
              {
                "@type": "CollectionPage",
                name: "全国凤楼地区导航",
                url: directoryUrl,
                mainEntity: {
                  "@type": "ItemList",
                  numberOfItems: availableLocations.length,
                  itemListElement: availableLocations.map((location, index) => ({
                    "@type": "ListItem",
                    position: index + 1,
                    name: `${location.name}凤楼`,
                    url: getSeoLocationUrl(location, origin),
                  })),
                },
              },
            ],
          }),
        }}
      />

      <header className="sticky top-0 z-10 bg-gradient-to-r from-pink-500 to-rose-500 px-4 pb-4 pt-6 text-white shadow-md">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">
            {site.name}
          </Link>
          <UserStatus username={user?.username} isMember={isActiveMember(user)} />
        </div>
      </header>

      <main className="px-4 pt-4">
        <nav aria-label="面包屑" className="text-xs text-gray-500">
          <Link href="/" className="hover:text-pink-500">
            首页
          </Link>
          <span className="px-1" aria-hidden="true">›</span>
          <span aria-current="page">全国地区</span>
        </nav>

        <section className="mt-4">
          <h1 className="mb-3 text-lg font-bold text-gray-900">全国凤楼地区导航</h1>
          <SeoLocationPicker
            availableLocationSlugs={[...availableLocationSlugs]}
            defaultOpen
          />
          <p className="mt-3 px-1 text-xs leading-5 text-gray-400">
            灰色地区暂时没有公开信息，增加第1条后会自动开放。
          </p>
        </section>
      </main>
    </div>
  );
}
