import { isIP } from "node:net";

const ORIGIN = "https://66feng.com";
const API_URL = `${ORIGIN}/api/base/public/post/list`;
const MAX_JSON_BYTES = 1_500_000;
const MAX_PAGE = 10_000;
const UNSAFE_TEXT = /[\s\u0000-\u001f\u007f#\\]/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Partner66fengErrorCode = "INVALID_SOURCE" | "INVALID_RESPONSE" | "UNSAFE_IMAGE" | "DETAIL_LIMIT";

const MESSAGES: Record<Partner66fengErrorCode, string> = {
  INVALID_SOURCE: "来源列表地址或筛选参数无效，请检查设置。",
  INVALID_RESPONSE: "来源列表数据结构或分页信息无效，请稍后重试。",
  UNSAFE_IMAGE: "来源图片地址不安全，请检查来源设置。",
  DETAIL_LIMIT: "来源单帖图片数量超过上限。",
};

export class Partner66fengError extends Error {
  readonly code: Partner66fengErrorCode;

  constructor(code: Partner66fengErrorCode) {
    super(MESSAGES[code]);
    this.name = "Partner66fengError";
    this.code = code;
  }
}

function fail(code: Partner66fengErrorCode): never {
  throw new Partner66fengError(code);
}

type Request = {
  apiUrl: string;
  jsonBody: { page: number; city_id: string; post_type: number[] };
  pageUrl: string;
};

function canonicalPage(city: string, page: number, types: readonly number[]): string {
  const url = new URL("/list", ORIGIN);
  url.searchParams.set("city_id", city);
  url.searchParams.set("page", String(page));
  url.searchParams.set("post_type", types.join(","));
  return url.href;
}

/** Pure source recognition and request planning; it does not make a request. */
export function partner66fengRequest(rawUrl: string): Request | null {
  if (typeof rawUrl !== "string") return fail("INVALID_SOURCE");
  let url: URL;
  try { url = new URL(rawUrl); } catch { return fail("INVALID_SOURCE"); }
  if (url.hostname === "66feng.com" && url.origin !== ORIGIN) return fail("INVALID_SOURCE");
  if (url.origin !== ORIGIN) return null;
  if (typeof rawUrl !== "string" || rawUrl.length > 2048 || UNSAFE_TEXT.test(rawUrl)
    || !/^https:\/\//i.test(rawUrl) || rawUrl.match(/^https:\/\/([^/?]*)/i)?.[1].includes("@")
    || url.username || url.password || url.hash || url.port || url.pathname !== "/list") return fail("INVALID_SOURCE");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== new Set(keys).size || keys.some(key => !["city_id", "page", "post_type"].includes(key))) return fail("INVALID_SOURCE");
  const city = url.searchParams.get("city_id");
  const rawPage = url.searchParams.get("page") ?? "1";
  const rawTypes = url.searchParams.get("post_type") ?? "0";
  if (!city || !/^[0-9]{6}$/.test(city) || !/^[1-9][0-9]{0,4}$/.test(rawPage)) return fail("INVALID_SOURCE");
  const page = Number(rawPage);
  const values = rawTypes.split(",");
  if (page > MAX_PAGE || values.length > 12 || values.some(value => !/^(?:0|[1-9][0-9]{0,2})$/.test(value) || Number(value) > 100)) return fail("INVALID_SOURCE");
  const types = [...new Set(values.map(Number))];
  return { apiUrl: API_URL, jsonBody: { page, city_id: city, post_type: types }, pageUrl: canonicalPage(city, page, types) };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function imageUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 2048 || UNSAFE_TEXT.test(raw)
    || !(raw.startsWith("/") && !raw.startsWith("//") || /^https:\/\//i.test(raw))) return fail("UNSAFE_IMAGE");
  const authority = raw.match(/^https:\/\/([^/?]*)/i)?.[1];
  if (authority !== undefined && (!authority || authority.includes("@") || !/^[A-Za-z0-9.-]+(?::443)?$/.test(authority))) return fail("UNSAFE_IMAGE");
  let url: URL;
  try { url = new URL(raw, ORIGIN); } catch { return fail("UNSAFE_IMAGE"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return fail("UNSAFE_IMAGE");
  const host = url.hostname;
  // DNS resolution, public-address checks and the saved media-origin allowlist remain the fetcher's responsibility.
  // Literal IPs and local-only names are rejected here, including normalized numeric IPv4 spellings.
  if (isIP(host) || !host.includes(".") || host.length > 253 || host.endsWith(".")
    || /(?:^|\.)(?:localhost|local|internal|lan|home)$/i.test(host)
    || host.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return fail("UNSAFE_IMAGE");
  return url.href;
}

export type Partner66fengImages = {
  urls: string[];
  pageUrl: string;
  nextPageUrl: string | null;
  photoHints: Record<string, string[]>;
};

/** Reads only pagination, UUID and the explicit images object. No post text is returned or fetched. */
export function parsePartner66fengImages(jsonText: string, rawPageUrl: string): Partner66fengImages {
  const request = partner66fengRequest(rawPageUrl);
  if (!request) return fail("INVALID_SOURCE");
  if (typeof jsonText !== "string" || jsonText.length > MAX_JSON_BYTES || Buffer.byteLength(jsonText, "utf8") > MAX_JSON_BYTES) return fail("INVALID_RESPONSE");
  let root: unknown;
  try { root = JSON.parse(jsonText); } catch { return fail("INVALID_RESPONSE"); }
  if (!object(root) || typeof root.code !== "number" || !Number.isFinite(root.code)
    || !Array.isArray(root.data) || root.data.length > 50
    || !integer(root.total, 0, 10_000_000) || !integer(root.page, 1, MAX_PAGE) || !integer(root.page_size, 1, 50)
    || root.page !== request.jsonBody.page || root.data.length > root.page_size) return fail("INVALID_RESPONSE");
  const offset = (root.page - 1) * root.page_size;
  if (root.total < offset + root.data.length) return fail("INVALID_RESPONSE");
  const hasNext = root.page * root.page_size < root.total;
  if (hasNext && (!root.data.length || root.page >= MAX_PAGE)) return fail("INVALID_RESPONSE");
  const urls: string[] = [];
  const photoHints: Record<string, string[]> = {};
  for (const entry of root.data) {
    if (!object(entry) || typeof entry.uuid !== "string" || !UUID.test(entry.uuid) || !object(entry.images)
      || typeof entry.images.cover !== "string" || !Array.isArray(entry.images.images)
      || entry.images.images.some(value => typeof value !== "string")) return fail("INVALID_RESPONSE");
    if (entry.images.images.length > 8) return fail("DETAIL_LIMIT");
    const images: string[] = entry.images.images.length ? entry.images.images : entry.images.cover ? [entry.images.cover] : [];
    const hints = [...new Set(images.map(imageUrl))];
    const detail = new URL("/show", ORIGIN);
    detail.searchParams.set("uuid", entry.uuid.toLowerCase());
    const detailUrl = detail.href;
    if (Object.hasOwn(photoHints, detailUrl)) {
      if (JSON.stringify(photoHints[detailUrl]) !== JSON.stringify(hints)) return fail("INVALID_RESPONSE");
      continue;
    }
    urls.push(detailUrl);
    photoHints[detailUrl] = hints;
  }
  return { urls, pageUrl: request.pageUrl,
    nextPageUrl: hasNext ? canonicalPage(request.jsonBody.city_id, root.page + 1, request.jsonBody.post_type) : null, photoHints };
}
