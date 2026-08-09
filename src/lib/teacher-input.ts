import { normalizeProvince, provinceCities, resolveDistrict } from "@/data/locations";

export const MAX_TEACHER_PHOTOS = 12;
export const MAX_TEACHER_PHOTO_BYTES = 14 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const LOCATION_SUFFIX = /(?:特别行政区|自治州|地区|盟|省|市|区|县)$/;

export function imageExtension(type: string): string | undefined {
  return IMAGE_EXTENSIONS[type.toLowerCase()];
}

export function validateTeacherPhotos(files: Array<{ size: number; type: string }>): string | undefined {
  if (files.length > MAX_TEACHER_PHOTOS) {
    return `一次最多上传 ${MAX_TEACHER_PHOTOS} 张图片`;
  }
  if (files.some((file) => !imageExtension(file.type))) {
    return "仅支持 JPG、PNG、WebP 和 GIF 图片";
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TEACHER_PHOTO_BYTES) {
    return "图片压缩后总大小不能超过 14MB，请减少图片数量";
  }
  return undefined;
}

function resolveWithinProvince(province: string, city: string): string | undefined {
  const options = provinceCities[province] ?? [];
  const exact = options.find((option) => option === city);
  if (exact) return exact;

  const cityStem = city.replace(LOCATION_SUFFIX, "");
  const stemMatches = options.filter((option) => option.replace(LOCATION_SUFFIX, "") === cityStem);
  if (stemMatches.length === 1) return stemMatches[0];

  const prefixMatches = options.filter((option) => {
    const optionStem = option.replace(LOCATION_SUFFIX, "");
    return city.startsWith(option) || (optionStem.length >= 2 && city.startsWith(optionStem));
  });
  return prefixMatches.length === 1 ? city : undefined;
}

function resolveCityGlobally(city: string) {
  const exact = resolveDistrict(city);
  if (exact) return exact;

  const matches = Object.keys(provinceCities).flatMap((province) => {
    const district = resolveWithinProvince(province, city);
    return district ? [{ province, district }] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function normalizeTeacherLocation(provinceInput: string, cityInput: string) {
  const province = provinceInput.trim();
  const city = cityInput.trim();
  const normalizedProvince = normalizeProvince(province);
  const districtInProvince = normalizedProvince
    ? resolveWithinProvince(normalizedProvince, city)
    : undefined;
  const resolvedCity = districtInProvince
    ? { province: normalizedProvince!, district: districtInProvince }
    : resolveCityGlobally(city);

  return {
    city: resolvedCity?.province ?? normalizedProvince ?? province,
    district: resolvedCity?.district ?? city,
  };
}
