import type { Metadata } from "next";
import Link from "next/link";
import type { MerchantCardData } from "@/components/MerchantCard";
import { getPublishedMerchants } from "@/lib/merchants";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";
import { MerchantBrowser } from "./MerchantBrowser";
import type { MerchantCityOption } from "./MerchantCityPicker";

export const metadata: Metadata = {
  title: { absolute: `商家SPA｜${SITE_NAME}` },
  description: "查看公开展示的SPA商家、服务项目、价格、地址和联系方式。",
  alternates: { canonical: `${SITE_URL}/spa` },
};

type SpaPageProps = {
  searchParams: Promise<{ city?: string | string[] }>;
};

function readCityParam(value: string | string[] | undefined): string {
  return typeof value === "string" && value.length <= 120 ? value : "";
}

export default async function SpaPage({ searchParams }: SpaPageProps) {
  const query = await searchParams;
  const merchants = await getPublishedMerchants();
  const cityCounts = new Map<string, { province: string; city: string; count: number }>();

  for (const merchant of merchants) {
    if (!merchant.district) continue;
    const key = `${merchant.city}::${merchant.district}`;
    const existing = cityCounts.get(key);
    cityCounts.set(key, {
      province: merchant.city,
      city: merchant.district,
      count: (existing?.count ?? 0) + 1,
    });
  }

  const cityOptions: MerchantCityOption[] = [...cityCounts.entries()]
    .map(([value, item]) => ({ value, ...item }))
    .sort((left, right) =>
      `${left.province}${left.city}`.localeCompare(`${right.province}${right.city}`, "zh-CN"),
    );
  const requestedCity = readCityParam(query.city);
  const hasExplicitSelection = cityCounts.has(requestedCity);
  const selectedCity = hasExplicitSelection ? requestedCity : "";
  const merchantCards: MerchantCardData[] = merchants.map((merchant) => ({
    id: merchant.id,
    name: merchant.name,
    city: merchant.city,
    district: merchant.district,
    price: merchant.price,
    services: merchant.services,
    photos: merchant.photos,
  }));

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-4 text-white shadow-md">
        <Link href="/" className="text-white/90">← 返回</Link>
        <h1 className="text-lg font-bold">商家SPA</h1>
      </header>

      <MerchantBrowser
        options={cityOptions}
        merchants={merchantCards}
        initialSelectedValue={selectedCity}
      />
    </div>
  );
}
