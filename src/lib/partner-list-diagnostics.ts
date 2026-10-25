import { load } from "cheerio";

const MAX_HTML_BYTES = 2_000_000;
const MAX_JSON_BYTES = 1_500_000;
const MAX_VISITS = 40_000;
const MAX_DEPTH = 30;
const MAX_URL_LENGTH = 4096;
const UNSAFE_URL_TEXT = /[\s\u0000-\u001f\u007f#\\]/u;

export type PartnerListStructureSummary = {
  status: "ok" | "invalid_input" | "too_large" | "parse_failed";
  htmlBytes: number;
  pageUrlValid: boolean;
  anchorsWithHref: number;
  anchorsWithoutHref: number;
  exactConfiguredShapeCount: number;
  resolvedShowUuidLinks: number;
  onclickCount: number;
  dataHrefCount: number;
  dataToCount: number;
  toAttributeCount: number;
  headingLinks: number;
  wrappedHeadings: number;
  wrappedHeadingLinks: number;
  imageElementCount: number;
  scriptCount: number;
  externalScriptCount: number;
  nuxtPayloadCount: number;
  nuxtParseable: boolean;
  nuxtJsonBytes: number;
  nuxtFlatNodeCount: number;
  nuxtVisitedCount: number;
  nuxtJsonLimitReached: boolean;
  nuxtVisitLimitReached: boolean;
  nuxtDepthLimitReached: boolean;
  nuxtKeyOccurrences: {
    uuid: number; id: number; list: number; items: number; records: number;
    imageList: number; total: number; page: number; pageSize: number; city_id: number;
  };
  cloudflareMarker: boolean;
  captchaMarker: boolean;
  loginMarker: boolean;
};

function emptySummary(): PartnerListStructureSummary {
  return {
    status: "ok", htmlBytes: 0, pageUrlValid: false,
    anchorsWithHref: 0, anchorsWithoutHref: 0, exactConfiguredShapeCount: 0, resolvedShowUuidLinks: 0,
    onclickCount: 0, dataHrefCount: 0, dataToCount: 0, toAttributeCount: 0,
    headingLinks: 0, wrappedHeadings: 0, wrappedHeadingLinks: 0, imageElementCount: 0,
    scriptCount: 0, externalScriptCount: 0, nuxtPayloadCount: 0, nuxtParseable: false,
    nuxtJsonBytes: 0, nuxtFlatNodeCount: 0, nuxtVisitedCount: 0,
    nuxtJsonLimitReached: false, nuxtVisitLimitReached: false, nuxtDepthLimitReached: false,
    nuxtKeyOccurrences: { uuid: 0, id: 0, list: 0, items: 0, records: 0, imageList: 0, total: 0, page: 0, pageSize: 0, city_id: 0 },
    cloudflareMarker: false, captchaMarker: false, loginMarker: false,
  };
}

function safeUrl(raw: unknown, base?: string): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL_LENGTH || UNSAFE_URL_TEXT.test(raw)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https:\/\//i.test(raw)) return null;
  const authority = raw.match(/^(?:https:)?\/\/([^/?]*)/i)?.[1];
  if (authority !== undefined && (!authority || authority.includes("@"))) return null;
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port ? url : null;
  } catch { return null; }
}

function summarizeJson(value: unknown, summary: PartnerListStructureSummary, budget: { remaining: number }) {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (pending.length && budget.remaining > 0) {
    const current = pending.pop()!;
    budget.remaining--;
    summary.nuxtVisitedCount++;
    if (!current.value || typeof current.value !== "object") continue;
    if (current.depth >= MAX_DEPTH) {
      summary.nuxtDepthLimitReached = true;
      continue;
    }
    // JSON.parse creates inert data only. Own-property reads are budgeted too;
    // arbitrary keys and every property value remain local to this traversal.
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      if (budget.remaining <= pending.length) {
        summary.nuxtVisitLimitReached = true;
        break;
      }
      budget.remaining--;
      summary.nuxtVisitedCount++;
      if (Object.hasOwn(summary.nuxtKeyOccurrences, key)) {
        summary.nuxtKeyOccurrences[key as keyof typeof summary.nuxtKeyOccurrences]++;
      }
      pending.push({ value: (current.value as Record<string, unknown>)[key], depth: current.depth + 1 });
    }
  }
  if (pending.length) summary.nuxtVisitLimitReached = true;
}

/**
 * A privacy boundary: only this fixed set of counts, flags and status enums may
 * leave the function. It never returns text, attributes, URLs, JSON data or errors,
 * and it performs no filesystem, network, database or script execution.
 */
export function summarizePartnerListStructure(html: string, pageUrl: string): PartnerListStructureSummary {
  const summary = emptySummary();
  if (typeof html !== "string") { summary.status = "invalid_input"; return summary; }
  summary.htmlBytes = Buffer.byteLength(html, "utf8");
  if (summary.htmlBytes > MAX_HTML_BYTES) { summary.status = "too_large"; return summary; }
  const page = safeUrl(pageUrl);
  summary.pageUrlValid = page !== null;
  try {
    const $ = load(html);
    summary.anchorsWithHref = $("a[href]").length;
    summary.anchorsWithoutHref = $("a:not([href])").length;
    summary.exactConfiguredShapeCount = $('a[href*="/show?uuid="]').length;
    if (page) $("a[href]").each((_, element) => {
      const url = safeUrl($(element).attr("href"), page.href);
      if (url?.origin === page.origin && url.pathname === "/show" && url.searchParams.get("uuid")?.trim()) {
        summary.resolvedShowUuidLinks++;
      }
    });
    summary.onclickCount = $("[onclick]").length;
    summary.dataHrefCount = $("[data-href]").length;
    summary.dataToCount = $("[data-to]").length;
    summary.toAttributeCount = $("[to]").length;
    summary.headingLinks = $("h1 a[href], h2 a[href], h3 a[href], h4 a[href]").length;
    summary.wrappedHeadings = $("a[href] h2, a[href] h3, a[href] h4").length;
    summary.wrappedHeadingLinks = $("a[href]:has(h2), a[href]:has(h3), a[href]:has(h4)").length;
    summary.imageElementCount = $("img").length;
    summary.scriptCount = $("script").length;
    summary.externalScriptCount = $("script[src]").length;
    const nuxt = $("script#__NUXT_DATA__");
    summary.nuxtPayloadCount = nuxt.length;
    summary.nuxtParseable = nuxt.length > 0;
    const budget = { remaining: MAX_VISITS };
    nuxt.each((_, element) => {
      const script = $(element);
      const serialized = script.html() ?? "";
      const bytes = Buffer.byteLength(serialized, "utf8");
      summary.nuxtJsonBytes += bytes;
      if (summary.nuxtJsonBytes > MAX_JSON_BYTES) {
        summary.nuxtJsonLimitReached = true;
        summary.nuxtParseable = false;
        return;
      }
      if (script.attr("type")?.trim().toLowerCase() !== "application/json") {
        summary.nuxtParseable = false;
        return;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(serialized); }
      catch { summary.nuxtParseable = false; return; }
      if (Array.isArray(parsed)) summary.nuxtFlatNodeCount += parsed.length;
      if (budget.remaining > 0) summarizeJson(parsed, summary, budget);
      else summary.nuxtVisitLimitReached = true;
    });
    const lower = html.toLowerCase();
    summary.cloudflareMarker = ["__cf_chl_", "cf-chl-", "/cdn-cgi/challenge-platform/"].some(marker => lower.includes(marker));
    summary.captchaMarker = $('[data-sitekey], .g-recaptcha, .h-captcha, script[src*="recaptcha"], script[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').length > 0;
    summary.loginMarker = $('input[type="password"]').length > 0
      || $("form[action]").toArray().some(element => /(?:^|\/)(?:login|signin|sign-in)(?:[/?#]|$)/i.test($(element).attr("action") ?? ""));
  } catch {
    // Even unexpected parser errors cross this boundary only as a fixed enum.
    summary.status = "parse_failed";
  }
  return summary;
}
