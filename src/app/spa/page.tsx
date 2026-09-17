import type { Metadata } from "next";
import Link from "next/link";
import { MerchantCard } from "@/components/MerchantCard";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import { getSeoLocationBySlug, getSeoLocationFromSelection, getSeoLocationsForRecord, getSeoLocationSlugsForRecords } from "@/lib/location-seo";
import { getPublishedMerchants } from "@/lib/merchants";
import { getCurrentSite } from "@/lib/site";
import { siteOrigin } from "@/lib/site-utils";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getCurrentSite();
  return {
    title: { absolute: `9895会所｜${site.name}` },
    description: "查看公开展示的9895会所商家、服务项目、价格、地址和联系方式。",
    alternates: { canonical: `${siteOrigin(site)}/spa` },
  };
}

type SpaPageProps = {
  searchParams: Promise<{ city?: string | string[]; location?: string | string[] }>;
};

function readCityParam(value: string | string[] | undefined): string {
  return typeof value === "string" && value.length <= 120 ? value : "";
}

export default async function SpaPage({ searchParams }: SpaPageProps) {
  const query = await searchParams;
  const merchants = await getPublishedMerchants();
  const availableLocationSlugs = getSeoLocationSlugsForRecords(merchants);
  const [legacyProvince, legacyCity] = readCityParam(query.city).split("::");
  const requestedLocation = query.location !== undefined
    ? getSeoLocationBySlug(readCityParam(query.location))
    : getSeoLocationFromSelection(legacyProvince, legacyCity);
  const selectedLocation = requestedLocation && availableLocationSlugs.has(requestedLocation.slug)
    ? requestedLocation : undefined;
  const selectedProvince = selectedLocation
    ? getSeoLocationFromSelection(selectedLocation.province) : undefined;
  const visibleMerchants = selectedLocation
    ? merchants.filter((merchant) => getSeoLocationsForRecord(merchant.city, merchant.district)
      .some((location) => location.slug === selectedLocation.slug))
    : merchants;

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">9895会所</h1>
      </header>

      <div className="px-4 pt-4">
        <SeoLocationPicker
          availableLocationSlugs={[...availableLocationSlugs]}
          initialProvinceSlug={selectedProvince?.slug}
          selectedLabel={selectedLocation?.region ?? selectedLocation?.province}
          basePath="/spa"
          defaultOpen={Boolean(selectedLocation)}
        />
      </div>
      <div className="space-y-3 px-4 pt-4">
        {visibleMerchants.length === 0 && (
          <p className="py-20 text-center text-sm text-gray-400">暂时还没有公开商家</p>
        )}
        {visibleMerchants.map((merchant) => <MerchantCard key={merchant.id} merchant={merchant} />)}
      </div>
    </div>
  );
}
