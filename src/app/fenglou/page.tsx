import type { Metadata } from "next";
import Link from "next/link";
import { UserStatus } from "@/components/UserStatus";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import { getCurrentUser } from "@/lib/user-auth";
import { isActiveMember } from "@/lib/membership";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { getAvailableSeoLocationSlugs } from "@/lib/teachers";

const DIRECTORY_URL = `${SITE_URL}/fenglou`;

export const metadata: Metadata = {
  title: { absolute: "全国凤楼地区导航｜全国地区信息" },
  description: "凤楼全国地区导航，按省份和城市查看地区信息。",
  alternates: { canonical: DIRECTORY_URL },
  openGraph: {
    title: "全国凤楼地区导航｜全国地区信息",
    description: "凤楼全国地区导航，按省份和城市查看地区信息。",
    url: DIRECTORY_URL,
    siteName: SITE_NAME,
    locale: "zh_CN",
    type: "website",
  },
};

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default async function FenglouDirectoryPage() {
  const [user, availableLocationSlugs] = await Promise.all([
    getCurrentUser(),
    getAvailableSeoLocationSlugs(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 pb-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "全国地区", item: DIRECTORY_URL },
            ],
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
