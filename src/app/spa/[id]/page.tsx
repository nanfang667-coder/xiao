import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/app/teacher/[id]/Gallery";
import { formatLocationLabel } from "@/lib/location-label";
import { getPublishedMerchantById } from "@/lib/merchants";
import { SITE_NAME, SITE_URL } from "@/lib/site-config";

type MerchantPageProps = {
  params: Promise<{ id: string }>;
};

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export async function generateMetadata({ params }: MerchantPageProps): Promise<Metadata> {
  const { id } = await params;
  const merchant = await getPublishedMerchantById(id);
  if (!merchant) return { title: "商家不存在", robots: { index: false, follow: false } };

  const location = formatLocationLabel(merchant.city, merchant.district);
  const title = `${truncate(`${merchant.name}｜${location || "商家SPA"}`, 54)} | ${SITE_NAME}`;
  const description = truncate(compactText(merchant.description || merchant.services), 160);
  const canonical = `${SITE_URL}/spa/${merchant.id}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: SITE_NAME, locale: "zh_CN", type: "website" },
  };
}

export default async function MerchantDetailPage({ params }: MerchantPageProps) {
  const { id } = await params;
  const merchant = await getPublishedMerchantById(id);
  if (!merchant) notFound();

  const location = formatLocationLabel(merchant.city, merchant.district);
  const contacts = [
    ["电话", merchant.phone],
    ["微信", merchant.wechat],
    ["QQ", merchant.qq],
    ["其他", merchant.otherContact],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="mx-auto w-full max-w-md flex-1 pb-10">
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <Link href="/spa" className="text-pink-500">← 商家SPA</Link>
      </div>

      <Gallery photos={merchant.photos} emoji="🏪" alt={`${location}${merchant.name}的商家照片`} />

      <div className="px-4">
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          {location && <p className="text-xs text-gray-400">📍 {location}</p>}
          <h1 className="mt-2 text-lg font-bold text-gray-900">{merchant.name}</h1>
          {merchant.price && <p className="mt-2 text-xl font-bold text-rose-500">{merchant.price}</p>}
        </section>

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-800">服务项目</h2>
          <p className="whitespace-pre-line text-sm leading-6 text-gray-600">{merchant.services}</p>
        </section>

        {merchant.description && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">商家介绍</h2>
            <p className="whitespace-pre-line text-sm leading-6 text-gray-600">{merchant.description}</p>
          </section>
        )}

        {merchant.address && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-gray-800">详细地址</h2>
            <p className="text-sm text-gray-700">{merchant.address}</p>
          </section>
        )}

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-800">公开联系方式</h2>
          {contacts.length > 0 ? (
            <div className="space-y-2">
              {contacts.map(([label, value]) => (
                <div key={label} className="flex items-start gap-3 text-sm">
                  <span className="w-10 flex-none text-gray-400">{label}</span>
                  <span className="break-all font-medium text-gray-700">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">商家暂未填写联系方式</p>
          )}
        </section>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          请自行核实商家信息，谨慎对待定金、储值、办卡和提前付款要求。
        </div>
      </div>
    </div>
  );
}
