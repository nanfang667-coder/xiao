import Link from "next/link";
import { formatLocationLabel } from "@/lib/location-label";
import type { Merchant } from "@/lib/merchants";
import { isImage } from "@/lib/photo";

export type MerchantCardData = Pick<
  Merchant,
  "id" | "name" | "city" | "district" | "price" | "services" | "photos"
>;

export function MerchantCard({ merchant }: { merchant: MerchantCardData }) {
  const location = formatLocationLabel(merchant.city, merchant.district);

  return (
    <Link href={`/spa/${merchant.id}`} className="flex overflow-hidden rounded-2xl bg-white shadow-sm transition active:scale-[0.99]">
      {merchant.photos[0] && isImage(merchant.photos[0]) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={merchant.photos[0]} alt={`${merchant.name}商家照片`} className="h-28 w-28 flex-none object-cover" />
      ) : (
        <div className="flex h-28 w-28 flex-none items-center justify-center bg-gradient-to-br from-amber-100 to-orange-200 text-4xl">🏪</div>
      )}
      <div className="min-w-0 flex-1 p-3">
        {location && <p className="text-xs text-gray-400">📍 {location}</p>}
        <h2 className="mt-1 truncate text-sm font-bold text-gray-800">{merchant.name}</h2>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{merchant.services}</p>
        {merchant.price && <p className="mt-2 text-sm font-bold text-rose-500">{merchant.price}</p>}
      </div>
    </Link>
  );
}
