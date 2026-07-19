"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  getSeoLocationPath,
  SEO_LOCATION_GROUPS,
  type SeoLocation,
} from "@/lib/location-seo";

type PickerView = "provinces" | "regions" | null;

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
  const availableSlugs = useMemo(
    () => new Set(availableLocationSlugs),
    [availableLocationSlugs],
  );
  const initialGroup = SEO_LOCATION_GROUPS.find(
    (group) => group.province.slug === initialProvinceSlug,
  );
  const [view, setView] = useState<PickerView>(
    defaultOpen ? (initialGroup ? "regions" : "provinces") : null,
  );
  const [selectedProvinceSlug, setSelectedProvinceSlug] = useState(
    initialGroup?.province.slug ?? "",
  );
  const selectedGroup = SEO_LOCATION_GROUPS.find(
    (group) => group.province.slug === selectedProvinceSlug,
  );

  const chooseProvince = (provinceSlug: string) => {
    setSelectedProvinceSlug(provinceSlug);
    setView("regions");
  };

  const togglePicker = () => {
    if (view) {
      setView(null);
      return;
    }
    setView(selectedGroup ? "regions" : "provinces");
  };

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

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-bold text-gray-800">
          📍 {selectedGroup?.province.province ?? "全部地区"}
        </span>
        <button
          type="button"
          onClick={togglePicker}
          className="flex-none rounded-full border border-pink-400 px-4 py-1.5 text-sm text-pink-500 active:bg-pink-50"
          aria-expanded={Boolean(view)}
        >
          {view ? "收起" : "选择地区"}
        </button>
      </div>

      {view === "provinces" && (
        <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3">
          <Link href="/" className="text-sm font-bold text-pink-500">
            全部
          </Link>
          {SEO_LOCATION_GROUPS.map((group) => {
            const available = availableSlugs.has(group.province.slug);
            return (
              <button
                key={group.province.slug}
                type="button"
                onClick={() => chooseProvince(group.province.slug)}
                className={`truncate text-left text-sm transition ${
                  available ? "text-gray-800 hover:text-pink-500" : "text-gray-400"
                }`}
                aria-label={`选择${group.province.province}`}
              >
                {group.province.province}
              </button>
            );
          })}
        </div>
      )}

      {view === "regions" && selectedGroup && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setView("provinces")}
            className="mb-3 text-xs text-gray-400 hover:text-pink-500"
          >
            ‹ 重新选择省份
          </button>
          <div className="grid grid-cols-3 gap-x-3 gap-y-3">
            {regionOption(selectedGroup.province, "全部")}
            {selectedGroup.regions.map((region) => regionOption(region))}
          </div>
        </div>
      )}
    </div>
  );
}
