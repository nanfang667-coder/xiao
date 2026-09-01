import {
  normalizeProvince,
  provinceCities,
  resolveAlleyImportLocation,
  resolveDistrict,
} from "@/data/locations";
import { withAlleyTitleSuffix } from "@/lib/alley-title";

export const MAX_BULK_ALLEY_ROWS = 100;
export const MAX_BULK_ALLEY_TOTAL_CHARS = 500_000;

export type BulkAlleyField = {
  label: string;
  value: string;
};

export type BulkAlleySourceRow = {
  sourceRow: number;
  city: string;
  fields: BulkAlleyField[];
};

export type BulkAlleyLocationOverride = {
  province: string;
  district: string;
};

export type PreparedBulkAlley = {
  sourceRow: number;
  title: string;
  province: string;
  district: string;
  description: string;
};

export type BulkAlleyPreviewStatus =
  | "ready"
  | "unmatched"
  | "invalid"
  | "duplicate";

export type BulkAlleyPreviewRow = PreparedBulkAlley & {
  status: BulkAlleyPreviewStatus;
  message: string;
};

type PrepareResult =
  | { success: true; data: PreparedBulkAlley }
  | {
      success: false;
      status: "unmatched" | "invalid";
      message: string;
      data: PreparedBulkAlley;
    };

function cleanCell(value: string): string {
  return value.normalize("NFKC").trim();
}

function emptyPrepared(sourceRow: number, title: string): PreparedBulkAlley {
  return {
    sourceRow,
    title,
    province: "",
    district: "",
    description: "",
  };
}

export function buildBulkAlleyDescription(fields: BulkAlleyField[]): string {
  return fields
    .map((field, index) => {
      const label = cleanCell(field.label) || `信息 ${index + 1}`;
      const value = cleanCell(field.value);
      return value ? `${label}：${value}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function resolveManualLocation(
  override: BulkAlleyLocationOverride,
): { province: string; district: string } | undefined {
  const province = normalizeProvince(override.province);
  if (!province) return undefined;

  const requestedDistrict = cleanCell(override.district);
  if (!requestedDistrict) return { province, district: "" };

  if (provinceCities[province]?.includes(requestedDistrict)) {
    return { province, district: requestedDistrict };
  }

  const resolved = resolveDistrict(requestedDistrict);
  if (resolved?.province === province) return resolved;
  return undefined;
}

export function prepareBulkAlleySource(
  source: BulkAlleySourceRow,
  override?: BulkAlleyLocationOverride,
): PrepareResult {
  const cityName = cleanCell(source.city);
  const locationName = cityName.endsWith("站街")
    ? cityName.slice(0, -2).trim()
    : cityName;
  const title = withAlleyTitleSuffix(cityName);
  const empty = emptyPrepared(source.sourceRow, title);

  if (!Number.isSafeInteger(source.sourceRow) || source.sourceRow < 2) {
    return {
      success: false,
      status: "invalid",
      message: "来源行号无效",
      data: empty,
    };
  }
  if (!cityName) {
    return {
      success: false,
      status: "invalid",
      message: "城市不能为空",
      data: empty,
    };
  }
  if (title.length > 120) {
    return {
      success: false,
      status: "invalid",
      message: "添加“站街”后的标题不能超过 120 个字符",
      data: empty,
    };
  }
  if (!Array.isArray(source.fields) || source.fields.length > 30) {
    return {
      success: false,
      status: "invalid",
      message: "每行最多支持 30 个信息字段",
      data: empty,
    };
  }
  if (
    source.fields.some(
      (field) =>
        typeof field?.label !== "string" ||
        typeof field?.value !== "string" ||
        field.label.length > 60 ||
        field.value.length > 10_000,
    )
  ) {
    return {
      success: false,
      status: "invalid",
      message: "字段标题或内容过长",
      data: empty,
    };
  }

  const description = buildBulkAlleyDescription(source.fields);
  const partial = { ...empty, description };
  if (!description) {
    return {
      success: false,
      status: "invalid",
      message: "除城市外至少需要填写一项详细信息",
      data: partial,
    };
  }
  if (description.length > 10_000) {
    return {
      success: false,
      status: "invalid",
      message: "合并后的详细介绍不能超过 10000 个字符",
      data: partial,
    };
  }

  const location = override
    ? resolveManualLocation(override)
    : resolveAlleyImportLocation(locationName);
  if (!location) {
    return {
      success: false,
      status: "unmatched",
      message: "无法自动识别城市，请手动选择省份和城市／地区",
      data: partial,
    };
  }

  return {
    success: true,
    data: {
      ...partial,
      province: location.province,
      district: location.district,
    },
  };
}

export function bulkAlleyDuplicateKey(
  title: string,
  description: string,
): string {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
  return `${normalize(title)}\u0000${normalize(description)}`;
}