import Link from "next/link";
import {
  getSeoLocationPath,
  SEO_LOCATION_GROUPS,
  type SeoLocation,
} from "@/lib/location-seo";

type SeoLocationPickerProps = {
  availableLocationSlugs: string[];
  defaultOpen?: boolean;
  initialProvinceSlug?: string;
};

export function SeoLocationPicker({
  availableLocationSlugs,
  defaultOpen = false,
  initialProvinceSlug,
}: SeoLocationPickerProps) {
  const availableSlugs = new Set(availableLocationSlugs);
  const initialGroup = SEO_LOCATION_GROUPS.find(
    (group) => group.province.slug === initialProvinceSlug,
  );

  const regionOption = (
    location: SeoLocation,
    label = location.region ?? location.province,
  ) => {
    const available = availableSlugs.has(location.slug);
    return available ? (
      <Link
        key={location.slug}
        href={getSeoLocationPath(location)}
        className="truncate text-left text-sm text-gray-800 transition hover:text-pink-500"
      >
        {label}
      </Link>
    ) : (
      <span
        key={location.slug}
        aria-disabled="true"
        title="暂无公开信息，增加第1条后自动开放"
        className="cursor-not-allowed truncate text-left text-sm text-gray-300"
      >
        {label}
      </span>
    );
  };

  const provinceOptions = (
    <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3">
      <Link href="/" className="text-sm font-bold text-pink-500">
        全部
      </Link>
      {SEO_LOCATION_GROUPS.map((group) => {
        const available = availableSlugs.has(group.province.slug);
        return available ? (
          <Link
            key={group.province.slug}
            href={getSeoLocationPath(group.province)}
            className="truncate text-left text-sm text-gray-800 transition hover:text-pink-500"
          >
            {group.province.province}
          </Link>
        ) : (
          <span
            key={group.province.slug}
            aria-disabled="true"
            title="暂无公开信息，增加第1条后自动开放"
            className="truncate text-left text-sm text-gray-300"
          >
            {group.province.province}
          </span>
        );
      })}
    </div>
  );

  return (
    <details
      className="group rounded-2xl bg-white p-4 shadow-sm"
      open={defaultOpen || undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="truncate text-sm font-bold text-gray-800">
          📍 {initialGroup?.province.province ?? "全部地区"}
        </span>
        <span className="flex-none rounded-full border border-pink-400 px-4 py-1.5 text-sm text-pink-500 active:bg-pink-50">
          <span className="group-open:hidden">选择地区</span>
          <span className="hidden group-open:inline">收起</span>
        </span>
      </summary>

      {initialGroup ? (
        <div className="mt-4">
          <Link href="/fenglou" className="mb-3 inline-block text-xs text-gray-400 hover:text-pink-500">
            ‹ 重新选择省份
          </Link>
          <div className="grid grid-cols-3 gap-x-3 gap-y-3">
            {regionOption(initialGroup.province, "全部")}
            {initialGroup.regions.map((region) => regionOption(region))}
          </div>
        </div>
      ) : (
        provinceOptions
      )}
    </details>
  );
}
