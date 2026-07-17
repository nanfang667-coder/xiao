"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { citiesOfProvince, provinces } from "@/data/locations";

type Props = {
  province: string;
  city: string;
  query: string;
  total: number;
  allLocationTotal: number;
  provinceCounts: Record<string, number>;
  cityCounts: Record<string, number>;
};

export function AdminTeacherFilters({
  province,
  city,
  query,
  total,
  allLocationTotal,
  provinceCounts,
  cityCounts,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [picker, setPicker] = useState<"province" | "city" | null>(null);
  const [, startTransition] = useTransition();
  const cityOptions = province ? citiesOfProvince(province) : [];

  function updateFilters(next: {
    province?: string;
    city?: string;
  }) {
    const params = new URLSearchParams();
    const nextProvince = next.province ?? province;
    const nextCity = next.city ?? city;

    if (nextProvince) params.set("province", nextProvince);
    if (nextCity) params.set("city", nextCity);
    if (query) params.set("q", query);

    const queryString = params.toString();
    startTransition(() => {
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    });
  }

  function chooseProvince(nextProvince: string) {
    updateFilters({ province: nextProvince, city: "" });
    setPicker(nextProvince ? "city" : null);
  }

  function chooseCity(nextCity: string) {
    updateFilters({ city: nextCity });
    setPicker(null);
  }

  const summary = !province ? "全部地区" : city ? `${province} · ${city}` : province;
  const hasFilters = Boolean(province || city || query);

  return (
    <div className="space-y-3">
      <form action={pathname} method="get" className="rounded-2xl bg-white p-3 shadow-sm">
        {province && <input type="hidden" name="province" value={province} />}
        {city && <input type="hidden" name="city" value={city} />}
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder="搜索老师ID、姓名、手机或微信"
            aria-label="搜索老师"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
          />
          <button
            type="submit"
            className="rounded-xl bg-pink-500 px-4 text-sm font-bold text-white active:bg-pink-600"
          >
            搜索
          </button>
        </div>
      </form>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-800">📍 {summary}</p>
            <p className="mt-0.5 text-xs text-gray-400">当前条件共 {total} 位老师</p>
          </div>
          <button
            type="button"
            onClick={() => setPicker(picker ? null : province ? "city" : "province")}
            className="flex-none rounded-full border border-pink-400 px-4 py-1.5 text-sm text-pink-500 active:bg-pink-50"
          >
            {picker ? "收起" : "选择地区"}
          </button>
        </div>

        {picker === "province" && (
          <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3">
            <button
              type="button"
              onClick={() => chooseProvince("")}
              className={`text-left text-sm ${!province ? "font-bold text-pink-500" : "text-gray-700"}`}
            >
              全部 <span className="text-xs text-gray-400">{allLocationTotal}</span>
            </button>
            {provinces.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => chooseProvince(option)}
                className={`truncate text-left text-sm ${
                  province === option ? "font-bold text-pink-500" : "text-gray-700"
                }`}
                title={`${option} ${provinceCounts[option] ?? 0} 位`}
              >
                {option} <span className="text-xs text-gray-400">{provinceCounts[option] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {picker === "city" && province && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPicker("province")}
              className="mb-3 text-xs text-gray-400"
            >
              ‹ 重新选择省份
            </button>
            <div className="grid grid-cols-3 gap-x-2 gap-y-3">
              <button
                type="button"
                onClick={() => chooseCity("")}
                className={`text-left text-sm ${!city ? "font-bold text-pink-500" : "text-gray-700"}`}
              >
                全部
              </button>
              {cityOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => chooseCity(option)}
                  className={`truncate text-left text-sm ${
                    city === option ? "font-bold text-pink-500" : "text-gray-700"
                  }`}
                  title={`${option} ${cityCounts[option] ?? 0} 位`}
                >
                  {option} <span className="text-xs text-gray-400">{cityCounts[option] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
          className="w-full text-center text-xs text-gray-400"
        >
          清除全部筛选
        </button>
      )}
    </div>
  );
}
