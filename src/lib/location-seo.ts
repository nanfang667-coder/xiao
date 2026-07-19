import {
  citiesOfProvince,
  locationNamesMatch,
  normalizeLocationName,
  normalizeProvince,
  provinces,
  resolveDistrict,
} from "@/data/locations";

export type SeoLocation = {
  slug: string;
  name: string;
  province: string;
  region?: string;
};

const KNOWN_LOCATIONS: SeoLocation[] = [
  { slug: "beijing", name: "北京", province: "北京市" },
  { slug: "shanghai", name: "上海", province: "上海市" },
  { slug: "chongqing", name: "重庆", province: "重庆市" },
  { slug: "guangdong", name: "广东", province: "广东省" },
  { slug: "shandong", name: "山东", province: "山东省" },
  { slug: "taiwan", name: "台湾", province: "台湾省" },
  { slug: "hongkong", name: "香港", province: "香港特别行政区" },
  { slug: "macau", name: "澳门", province: "澳门特别行政区" },
  { slug: "guangzhou", name: "广州", province: "广东省", region: "广州市" },
  { slug: "shenzhen", name: "深圳", province: "广东省", region: "深圳市" },
  { slug: "sanya", name: "三亚", province: "海南省", region: "三亚市" },
  { slug: "kunming", name: "昆明", province: "云南省", region: "昆明市" },
];

export const FEATURED_SEO_LOCATIONS = KNOWN_LOCATIONS.filter((location) =>
  [
    "beijing",
    "shanghai",
    "chongqing",
    "shandong",
    "guangzhou",
    "shenzhen",
    "sanya",
    "kunming",
  ].includes(location.slug),
);

function locationKey(province: string, region?: string): string {
  return `${province}\u0000${region ?? ""}`;
}

function displayName(value: string): string {
  return value.replace(
    /(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|自治县|新区|地区|省|市|区|县|盟)$/,
    "",
  );
}

function canonicalProvince(value: string): string | undefined {
  return normalizeProvince(value) ?? provinces.find((province) => locationNamesMatch(value, province));
}

// URL 路由必须严格区分同名省份和城市/区县。
// 例如“河北区”属于天津市，不能因为包含“河北”而被识别成河北省。
function routeProvince(value: string): string | undefined {
  const trimmed = value.trim();
  return provinces.find(
    (province) => province === trimmed || displayName(province) === trimmed,
  );
}

function createSeoLocation(province: string, region?: string): SeoLocation {
  const known = KNOWN_LOCATIONS.find(
    (location) => locationKey(location.province, location.region) === locationKey(province, region),
  );
  if (known) return known;

  const source = region ?? province;
  return {
    slug: source,
    name: displayName(source),
    province,
    ...(region ? { region } : {}),
  };
}

function isRedundantRegion(province: string, region: string): boolean {
  return normalizeLocationName(province) === normalizeLocationName(region);
}

export const SEO_LOCATION_GROUPS = provinces.map((province) => ({
  province: createSeoLocation(province),
  regions: citiesOfProvince(province)
    .filter((region) => !isRedundantRegion(province, region))
    .map((region) => createSeoLocation(province, region)),
}));

export function getSeoLocationFromSelection(
  provinceValue: string,
  regionValue?: string,
): SeoLocation | undefined {
  const province = canonicalProvince(provinceValue);
  if (!province) return undefined;

  if (!regionValue) return createSeoLocation(province);

  const region = citiesOfProvince(province).find((option) =>
    locationNamesMatch(regionValue, option),
  );
  if (!region) return undefined;
  return isRedundantRegion(province, region)
    ? createSeoLocation(province)
    : createSeoLocation(province, region);
}

export function getSeoLocationBySlug(value: string): SeoLocation | undefined {
  let slug: string;
  try {
    slug = decodeURIComponent(value).trim();
  } catch {
    return undefined;
  }
  if (!slug) return undefined;

  const known = KNOWN_LOCATIONS.find((location) => location.slug === slug.toLowerCase());
  if (known) return known;

  const province = routeProvince(slug);
  if (province) return createSeoLocation(province);

  const resolved = resolveDistrict(slug);
  return resolved ? createSeoLocation(resolved.province, resolved.district) : undefined;
}

export function getSeoLocationsForRecord(
  provinceValue: string,
  regionValue?: string,
): SeoLocation[] {
  const province = canonicalProvince(provinceValue);
  if (!province) return [];

  const locations = [createSeoLocation(province)];
  if (regionValue) {
    const region = citiesOfProvince(province).find((option) =>
      locationNamesMatch(regionValue, option),
    );
    if (region && !isRedundantRegion(province, region)) {
      locations.push(createSeoLocation(province, region));
    }
  }
  return locations;
}

export function getSeoLocationSlugsForRecords(
  records: ReadonlyArray<{ city: string; district?: string | null }>,
  minimumRecords = 1,
): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const location of getSeoLocationsForRecord(
      record.city,
      record.district ?? undefined,
    )) {
      counts.set(location.slug, (counts.get(location.slug) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= minimumRecords)
      .map(([slug]) => slug),
  );
}

export function getSeoLocationPath(location: SeoLocation): string {
  return `/fenglou/${encodeURIComponent(location.slug)}`;
}

export function getSeoLocationUrl(location: SeoLocation, siteUrl: string): string {
  return new URL(getSeoLocationPath(location), siteUrl).toString();
}
