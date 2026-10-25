import { load } from "cheerio";
import type { PartnerImportRules } from "./partner-import-parser";

const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 2_000_000;
const TEMPLATE_BASE = "https://pagination.invalid/list";
const UNSAFE_URL_TEXT = /[\s\u0000-\u001f\u007f#\\]/u;
const INERT_CONTENT = "script, style, noscript, template, iframe, object, embed, svg, canvas";
const EXCLUDED_AREAS = '[hidden], [aria-hidden="true"], [aria-disabled="true"], [disabled], .disabled, .hidden, .d-none, .sr-only, .screen-reader-text, [data-import-ignore], [data-ad], [data-ad-slot], .advertisement, .advert, .ads, .ad, [aria-label="广告"]';
const INLINE_HIDDEN = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;
const NEXT_LABEL = /^(?:下一页|下页|next(?:\s+page)?|go\s+to\s+next\s+page)$/i;

export type PartnerImagePaginationErrorCode =
  | "INVALID_PAGINATION" | "AMBIGUOUS_PAGINATION" | "UNSAFE_PAGINATION" | "PAGINATION_LOOP";

const ERROR_MESSAGES: Record<PartnerImagePaginationErrorCode, string> = {
  INVALID_PAGINATION: "分页设置或页面内容无效，请检查分页配置。",
  AMBIGUOUS_PAGINATION: "找到多个不同的下一页，请指定准确的下一页选择器或分页模板。",
  UNSAFE_PAGINATION: "分页地址不安全或不属于当前来源网站，已停止翻页。",
  PAGINATION_LOOP: "下一页指向当前页面，已停止重复获取。",
};

export class PartnerImagePaginationError extends Error {
  readonly code: PartnerImagePaginationErrorCode;

  constructor(code: PartnerImagePaginationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "PartnerImagePaginationError";
    this.code = code;
  }
}

function fail(code: PartnerImagePaginationErrorCode): never {
  throw new PartnerImagePaginationError(code);
}

function pageUrl(raw: string, base?: string): URL {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL_LENGTH || UNSAFE_URL_TEXT.test(raw)) {
    return fail("UNSAFE_PAGINATION");
  }
  // Do not let WHATWG URL normalization repair ambiguous schemes or empty userinfo.
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https:\/\//i.test(raw)) return fail("UNSAFE_PAGINATION");
  const authority = raw.match(/^(?:https:)?\/\/([^/?]*)/i)?.[1];
  if (authority !== undefined && (!authority || authority.includes("@"))) return fail("UNSAFE_PAGINATION");
  let url: URL;
  try { url = base ? new URL(raw, base) : new URL(raw); }
  catch { return fail("UNSAFE_PAGINATION"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return fail("UNSAFE_PAGINATION");
  }
  return url;
}

/** Syntax validation is shared by saved source rules and the read-only planner. */
export function normalizePartnerPageUrlTemplate(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH
    || value.split("{page}").length !== 2 || /[{}]/u.test(value.replace("{page}", ""))) {
    return fail("INVALID_PAGINATION");
  }
  try {
    const first = pageUrl(value.replace("{page}", "1"), TEMPLATE_BASE);
    const second = pageUrl(value.replace("{page}", "2"), TEMPLATE_BASE);
    if (first.origin !== second.origin || first.href === second.href) return fail("INVALID_PAGINATION");
  } catch { return fail("INVALID_PAGINATION"); }
  return value;
}

function templatePage(template: string, current: URL, page: 1 | 2 | 3): URL {
  const normalized = normalizePartnerPageUrlTemplate(template);
  const base = normalized.startsWith("?") ? current.href : current.origin + "/";
  const target = pageUrl(normalized.replace("{page}", String(page)), base);
  if (target.origin !== current.origin) return fail("UNSAFE_PAGINATION");
  return target;
}

/**
 * Template paths, including bare relative paths, resolve from the source origin root.
 * Query-only templates keep the current pathname, preventing path accumulation on later pages.
 */
export function partnerImageStartPageUrl(inputUrl: string, rules: PartnerImportRules): string {
  const input = pageUrl(inputUrl);
  return rules.pageUrlTemplate === undefined ? input.href : templatePage(rules.pageUrlTemplate, input, 1).href;
}

function nextLabel(value: string | undefined): boolean {
  return value !== undefined && NEXT_LABEL.test(value.trim().replace(/^[\s>»›→←‹«]+|[\s>»›→←‹«]+$/gu, "").replace(/\s+/gu, " "));
}

export function parsePartnerImageNextPage(
  html: string,
  currentUrl: string,
  rules: PartnerImportRules,
  nextPageNumber: 2 | 3,
): string | null {
  if (nextPageNumber !== 2 && nextPageNumber !== 3) return fail("INVALID_PAGINATION");
  if (typeof html !== "string" || html.length > MAX_HTML_BYTES || Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return fail("INVALID_PAGINATION");
  }
  const current = pageUrl(currentUrl);
  if (rules.pageUrlTemplate !== undefined) {
    const target = templatePage(rules.pageUrlTemplate, current, nextPageNumber);
    if (target.href === current.href) return fail("PAGINATION_LOOP");
    return target.href;
  }
  const $ = load(html);
  $(INERT_CONTENT).remove();
  $(EXCLUDED_AREAS).remove();
  $("[style]").filter((_, element) => INLINE_HIDDEN.test($(element).attr("style") ?? "")).remove();
  let selected;
  if (rules.nextPageSelector !== undefined) {
    if (typeof rules.nextPageSelector !== "string" || !rules.nextPageSelector.trim() || rules.nextPageSelector.length > 500) {
      return fail("INVALID_PAGINATION");
    }
    try { selected = $(rules.nextPageSelector); }
    catch { return fail("INVALID_PAGINATION"); }
  } else {
    const pagination = $(".pagination, .paging, .paginator, [data-pagination], .pg:has(a.nxt)").add(
      $('nav[aria-label], [role="navigation"][aria-label]').filter((_, element) => /(?:pagination|分页|翻页|页码)/i.test($(element).attr("aria-label") ?? "")),
    );
    const labeled = pagination.find("a").filter((_, element) => {
      const link = $(element);
      return nextLabel(link.text()) || nextLabel(link.attr("aria-label")) || nextLabel(link.attr("title"));
    });
    const explicit = $("a[rel], link[rel]").filter((_, element) =>
      ($(element).attr("rel") ?? "").toLowerCase().split(/\s+/u).includes("next"));
    selected = explicit.add(labeled);
  }
  const candidates = new Set<string>();
  selected.each((_, element) => {
    const link = $(element);
    if (!link.is("a, link") || link.attr("href") === undefined) return fail("INVALID_PAGINATION");
    const target = pageUrl(link.attr("href")!, current.href);
    if (target.origin !== current.origin) return fail("UNSAFE_PAGINATION");
    if (target.href === current.href) return fail("PAGINATION_LOOP");
    candidates.add(target.href);
  });
  if (candidates.size > 1) return fail("AMBIGUOUS_PAGINATION");
  return candidates.values().next().value ?? null;
}
