import { load } from "cheerio";

export type PartnerNuxtImagesErrorCode =
  | "INVALID_RESPONSE" | "INVALID_URL" | "DETAIL_AMBIGUOUS_FIELDS" | "DETAIL_LIMIT";

/** Carries fixed diagnostics only; never include payloads, titles or URLs. */
export class PartnerNuxtImagesError extends Error {
  readonly code: PartnerNuxtImagesErrorCode;

  constructor(code: PartnerNuxtImagesErrorCode) {
    super("合作方图片数据无法安全解析，请检查来源规则。");
    this.name = "PartnerNuxtImagesError";
    this.code = code;
  }
}

const MAX_HTML_BYTES = 2_000_000;
const MAX_JSON_BYTES = 1_500_000;
const MAX_FLAT_NODES = 20_000;
const MAX_VISITED_NODES = 10_000;
const MAX_READS = 40_000;
const MAX_DEPTH = 30;
const MAX_IMAGES = 8;
const MAX_URL_LENGTH = 2_048;
const WRAPPERS = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef"]);
const BLOCKED_KEYS = new Set([
  "__proto__", "prototype", "constructor",
  "author", "authors", "authorinfo", "authorprofile", "authorbio",
  "user", "users", "userinfo", "userprofile",
  "comment", "comments", "commentlist",
  "related", "relatedposts", "relatedarticles",
  "recommendation", "recommendations", "recommendedposts",
  "ad", "ads", "advertisement", "advertisements",
  "site", "siteinfo", "siteconfig", "config", "configuration", "seo",
]);
const IGNORED_SCRIPT_AREAS = 'nav, header, footer, aside, form, template, noscript, [hidden], [aria-hidden="true"], [data-import-ignore], [data-ad], .comments, .comments-area, #comments, .related, .related-posts';
const INERT_TITLE_CONTENT = "script, style, noscript, template, iframe, object, embed, svg, canvas";

type FlatObject = Record<string, unknown>;
type Resolved = { index: number; value: unknown; depth: number };

function object(value: unknown): value is FlatObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code: PartnerNuxtImagesErrorCode): never {
  throw new PartnerNuxtImagesError(code);
}

function normalizedTitle(value: string): string {
  if (value.length > 2_000) fail("DETAIL_LIMIT");
  const $ = load(value, undefined, false);
  $(INERT_TITLE_CONTENT).remove();
  return $.root().text().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function pageId(detailUrl: string): string {
  if (detailUrl.length > MAX_URL_LENGTH) fail("INVALID_URL");
  try {
    const page = new URL(detailUrl);
    if (!["http:", "https:"].includes(page.protocol) || page.username || page.password) fail("INVALID_URL");
    const segment = page.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const id = decodeURIComponent(segment).replace(/\.(?:html?|php)$/i, "");
    if (!id || id.length > 256 || /[\/\\\u0000-\u001f]/.test(id)) fail("INVALID_URL");
    return id;
  } catch {
    fail("INVALID_URL");
  }
}

function blockedKey(key: string): boolean {
  return BLOCKED_KEYS.has(key.toLowerCase()) || BLOCKED_KEYS.has(key.replace(/[-_]/g, "").toLowerCase());
}

/**
 * Extract only an own imageList of one current-post record in a static Nuxt
 * devalue payload. articleTitle must come from the caller's unique valid article
 * h1; this module never obtains a title from JSON to manufacture that binding.
 * null means no supported bound record; [] means a bound, explicitly empty list.
 */
export function extractBoundNuxtImageUrls(input: {
  html: string;
  detailUrl: string;
  articleTitle: string;
}): string[] | null {
  if (typeof input.html !== "string" || typeof input.detailUrl !== "string"
    || typeof input.articleTitle !== "string") fail("INVALID_RESPONSE");
  if (Buffer.byteLength(input.html, "utf8") > MAX_HTML_BYTES) fail("DETAIL_LIMIT");
  // Cheerio is inert: scripts are parsed as text and are never evaluated.
  const $ = load(input.html);
  const scripts = $("script#__NUXT_DATA__").filter((_, element) => !$(element).closest(IGNORED_SCRIPT_AREAS).length);
  if (!scripts.length) return null;
  const expectedId = pageId(input.detailUrl);
  const expectedTitle = normalizedTitle(input.articleTitle);
  if (!expectedTitle) fail("INVALID_RESPONSE");
  if (scripts.length !== 1) fail("DETAIL_AMBIGUOUS_FIELDS");
  if (scripts.attr("type")?.trim().toLowerCase() !== "application/json") fail("INVALID_RESPONSE");
  const serialized = scripts.html() ?? "";
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) fail("DETAIL_LIMIT");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail("INVALID_RESPONSE");
  }
  if (!Array.isArray(parsed) || !parsed.length) fail("INVALID_RESPONSE");
  if (parsed.length > MAX_FLAT_NODES) fail("DETAIL_LIMIT");
  const flat: unknown[] = parsed;
  let reads = 0;

  // Resolve references without rebuilding or executing arbitrary objects. In
  // particular, do not traverse values under excluded author/config/etc. keys.
  function read(reference: unknown, depth: number): Resolved | null {
    const wrappersSeen = new Set<number>();
    let current = reference;
    let currentDepth = depth;
    while (true) {
      if (++reads > MAX_READS || currentDepth > MAX_DEPTH) fail("DETAIL_LIMIT");
      if (typeof current !== "number" || !Number.isInteger(current)) fail("INVALID_RESPONSE");
      // Devalue's negative sentinel references are not media or post records.
      if (current >= -6 && current < 0) return null;
      if (current < 0 || current >= flat.length) fail("INVALID_RESPONSE");
      if (wrappersSeen.has(current)) fail("INVALID_RESPONSE");
      wrappersSeen.add(current);
      const value = flat[current];
      if (Array.isArray(value) && typeof value[0] === "string") {
        // Unknown/custom types stay opaque; no constructor or callback runs.
        if (!WRAPPERS.has(value[0])) return null;
        if (value.length !== 2) fail("INVALID_RESPONSE");
        current = value[1];
        currentDepth++;
        continue;
      }
      return { index: current, value, depth: currentDepth };
    }
  }

  const seen = new Set<number>();
  let visited = 0;
  const matches: { record: FlatObject; depth: number }[] = [];

  function inspect(reference: unknown, depth: number): void {
    const resolved = read(reference, depth);
    if (!resolved || resolved.value === null || typeof resolved.value !== "object") return;
    if (seen.has(resolved.index)) return;
    seen.add(resolved.index);
    if (++visited > MAX_VISITED_NODES) fail("DETAIL_LIMIT");
    if (Array.isArray(resolved.value)) {
      for (const child of resolved.value) inspect(child, resolved.depth + 1);
      return;
    }
    const record = resolved.value as FlatObject;
    if (Object.hasOwn(record, "content") && Object.hasOwn(record, "imageList")
      && Object.hasOwn(record, "id") && Object.hasOwn(record, "title")) {
      const id = read(record.id, resolved.depth + 1)?.value;
      const title = read(record.title, resolved.depth + 1)?.value;
      const content = read(record.content, resolved.depth + 1)?.value;
      const validId = typeof id === "string" || typeof id === "number" && Number.isSafeInteger(id);
      if (validId && String(id) === expectedId && typeof title === "string"
        && normalizedTitle(title) === expectedTitle && typeof content === "string") {
        matches.push({ record, depth: resolved.depth });
        if (matches.length > 1) fail("DETAIL_AMBIGUOUS_FIELDS");
      }
    }
    for (const [key, child] of Object.entries(record)) {
      // imageList is interpreted only after binding, never searched for posts.
      if (blockedKey(key) || key === "imageList") continue;
      inspect(child, resolved.depth + 1);
    }
  }

  inspect(0, 0);
  if (!matches.length) return null;
  const listResult = read(matches[0].record.imageList, matches[0].depth + 1);
  if (!listResult || !Array.isArray(listResult.value)) fail("INVALID_RESPONSE");
  const list = listResult.value;
  if (list.length > MAX_IMAGES) fail("DETAIL_LIMIT");
  const urls = new Set<string>();
  for (const itemReference of list) {
    const itemResult = read(itemReference, listResult.depth + 1);
    if (!itemResult || !object(itemResult.value) || !Object.hasOwn(itemResult.value, "url")) fail("INVALID_RESPONSE");
    const raw = read(itemResult.value.url, itemResult.depth + 1)?.value;
    if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_URL_LENGTH) fail("INVALID_URL");
    try {
      // The confirmed source uses absolute HTTPS media URLs, including URLs
      // without file extensions. Fetching still requires the caller's allowlist.
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password) fail("INVALID_URL");
      url.hash = "";
      urls.add(url.href);
      if (urls.size > MAX_IMAGES) fail("DETAIL_LIMIT");
    } catch {
      fail("INVALID_URL");
    }
  }
  return [...urls];
}
