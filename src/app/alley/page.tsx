import type { Metadata } from "next";
import Link from "next/link";
import { AlleyImagePlaceholder } from "@/components/AlleyImagePlaceholder";
import { SeoLocationPicker } from "@/components/SeoLocationPicker";
import { locationNamesMatch } from "@/data/locations";
import { getPublishedAlleys } from "@/lib/alleys";
import { formatLocationLabel } from "@/lib/location-label";
import {
  getSeoLocationBySlug,
  getSeoLocationFromSelection,
  getSeoLocationSlugsForRecords,
} from "@/lib/location-seo";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import {
  ALLEY_DIRECT_ACCESS_ENABLED,
  ALLEY_PUBLIC_ENABLED,
} from "@/lib/feature-flags";
import { notFound } from "next/navigation";

export const metadata: Metadata = ALLEY_DIRECT_ACCESS_ENABLED
  ? {
      title: { absolute: `暗巷｜${SITE_NAME}` },
      description:
        "查看暗巷公开标题、地址和列表封面，详细介绍和详情图片可单篇解锁或由会员查看。",
      alternates: { canonical: `${SITE_URL}/alley` },
      ...(!ALLEY_PUBLIC_ENABLED
        ? { robots: { index: false, follow: false } }
        : {}),
    }
  : {
      title: "页面不存在",
      robots: { index: false, follow: false },
    };

type AlleyPageProps = {
  searchParams: Promise<{ location?: string | string[] }>;
};

function readLocationParam(value: string | string[] | undefined): string {
  return typeof value === "string" && value.length <= 120 ? value : "";
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function AlleyPage({ searchParams }: AlleyPageProps) {
  if (!ALLEY_DIRECT_ACCESS_ENABLED) notFound();

  const query = await searchParams;
  const alleys = await getPublishedAlleys();
  const availableLocationSlugs = getSeoLocationSlugsForRecords(alleys);
  const requestedLocation = getSeoLocationBySlug(
    readLocationParam(query.location),
  );
  const selectedLocation =
    requestedLocation && availableLocationSlugs.has(requestedLocation.slug)
      ? requestedLocation
      : undefined;
  const selectedProvince = selectedLocation
    ? getSeoLocationFromSelection(selectedLocation.province)
    : undefined;
  const visibleAlleys = selectedLocation
    ? alleys.filter(
        (alley) =>
          locationNamesMatch(alley.city, selectedLocation.province) &&
          (!selectedLocation.region ||
            locationNamesMatch(alley.district, selectedLocation.region)),
      )
    : alleys;

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">暗巷</h1>
      </header>

      <div className="px-4 pt-4">
        <SeoLocationPicker
          availableLocationSlugs={[...availableLocationSlugs]}
          initialProvinceSlug={selectedProvince?.slug}
          selectedLabel={selectedLocation?.region ?? selectedLocation?.province}
          basePath="/alley"
        />
      </div>

      <main className="space-y-3 px-4 pt-4">
        {visibleAlleys.length === 0 && (
          <div className="rounded-2xl bg-white py-16 text-center text-sm text-gray-400 shadow-sm">
            该地区暂时还没有暗巷信息
          </div>
        )}

        {visibleAlleys.map((alley) => {
          const location = formatLocationLabel(alley.city, alley.district);
          return (
            <Link
              key={alley.id}
              href={`/alley/${alley.id}`}
              className="flex overflow-hidden rounded-2xl bg-white shadow-sm transition active:scale-[0.99]"
            >
              {alley.coverPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={alley.coverPhoto}
                  alt={`${alley.title}列表封面`}
                  className="h-28 w-28 flex-none object-cover"
                />
              ) : (
                <AlleyImagePlaceholder className="h-28 w-28 flex-none" />
              )}
              <div className="min-w-0 flex-1 p-3">
                {location && (
                  <p className="text-xs text-gray-400">📍 {location}</p>
                )}
                <h2 className="mt-1 line-clamp-2 text-base font-bold text-gray-900">
                  {alley.title}
                </h2>
                {alley.address && (
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-gray-600">
                    {alley.address}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  发布于 {formatDate(alley.createdAt)}
                </p>
              </div>
            </Link>
          );
        })}
      </main>
    </div>
  );
}
