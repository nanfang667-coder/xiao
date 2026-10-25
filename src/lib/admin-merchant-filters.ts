import {
  citiesOfProvince,
  locationNamesMatch,
  normalizeProvince,
  provinces,
} from "@/data/locations";

type SearchParams = Record<string, string | string[] | undefined>;

export type AdminMerchantLocationFilters = {
  province: string;
  city: string;
};

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

export function parseAdminMerchantFilters(params: SearchParams): AdminMerchantLocationFilters {
  const province = normalizeProvince(firstValue(params.province)) ?? "";
  const rawCity = firstValue(params.city);
  const city = citiesOfProvince(province).includes(rawCity) ? rawCity : "";
  return { province, city };
}

// Merchant.city stores the province; Merchant.district stores the city or municipal district.
export function filterMerchantsForAdmin<T extends { city: string; district: string }>(
  merchants: readonly T[],
  filters: AdminMerchantLocationFilters,
) {
  const provinceCounts: Record<string, number> = Object.fromEntries(
    provinces.map((province) => [province, 0]),
  );
  const cityOptions = citiesOfProvince(filters.province);
  const cityCounts: Record<string, number> = Object.fromEntries(
    cityOptions.map((city) => [city, 0]),
  );
  const filtered: T[] = [];

  for (const merchant of merchants) {
    const province = normalizeProvince(merchant.city) ??
      provinces.find((option) => locationNamesMatch(merchant.city, option));
    if (province) provinceCounts[province] += 1;

    const inProvince = !filters.province || province === filters.province;
    const city = inProvince && filters.province
      ? cityOptions.find((option) => locationNamesMatch(merchant.district, option))
      : undefined;
    if (city) cityCounts[city] += 1;
    if (inProvince && (!filters.city || city === filters.city)) filtered.push(merchant);
  }

  return {
    merchants: filtered,
    total: filtered.length,
    allLocationTotal: merchants.length,
    provinceCounts,
    cityCounts,
  };
}
