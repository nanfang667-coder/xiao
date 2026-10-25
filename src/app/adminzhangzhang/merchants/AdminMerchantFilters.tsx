import Link from "next/link";
import { citiesOfProvince, provinces } from "@/data/locations";

type Props = {
  province: string;
  city: string;
  total: number;
  allLocationTotal: number;
  provinceCounts: Record<string, number>;
  cityCounts: Record<string, number>;
};

const merchantsPath = "/adminzhangzhang/merchants";

function locationHref(province = "", city = "") {
  const params = new URLSearchParams();
  if (province) {
    params.set("province", province);
    if (city) params.set("city", city);
  }
  const query = params.toString();
  return query ? `${merchantsPath}?${query}` : merchantsPath;
}

export function AdminMerchantFilters({
  province,
  city,
  total,
  allLocationTotal,
  provinceCounts,
  cityCounts,
}: Props) {
  const summary = !province ? "全部地区" : city ? `${province} · ${city}` : province;
  const options = province ? citiesOfProvince(province) : provinces;
  const counts = province ? cityCounts : provinceCounts;
  const selected = province ? city : "";
  const allCount = province ? (provinceCounts[province] ?? 0) : allLocationTotal;

  return (
    <details open className="group mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-gray-800">📍 {summary}</span>
          <span className="mt-0.5 block text-xs text-gray-400">当前条件共 {total} 家商家</span>
        </span>
        <span className="flex-none rounded-full border border-pink-400 px-4 py-1.5 text-sm text-pink-500 active:bg-pink-50">
          <span className="group-open:hidden">选择地区</span>
          <span className="hidden group-open:inline">收起</span>
        </span>
      </summary>

      <nav aria-label="商家地区筛选" className="mt-4">
        {province && (
          <Link
            href={merchantsPath}
            prefetch={false}
            scroll={false}
            className="mb-3 inline-block text-xs text-gray-400"
          >
            ‹ 重新选择省份
          </Link>
        )}
        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
          <Link
            href={locationHref(province)}
            prefetch={false}
            scroll={false}
            aria-current={!selected ? "page" : undefined}
            className={`text-left text-sm ${!selected ? "font-bold text-pink-500" : "text-gray-700"}`}
          >
            全部 <span className="text-xs text-gray-400">{allCount}</span>
          </Link>
          {options.map((option) => (
            <Link
              key={option}
              href={province ? locationHref(province, option) : locationHref(option)}
              prefetch={false}
              scroll={false}
              aria-current={selected === option ? "page" : undefined}
              className={`truncate text-left text-sm ${
                selected === option ? "font-bold text-pink-500" : "text-gray-700"
              }`}
              title={`${option} ${counts[option] ?? 0} 家`}
            >
              {option} <span className="text-xs text-gray-400">{counts[option] ?? 0}</span>
            </Link>
          ))}
        </div>
      </nav>
    </details>
  );
}
