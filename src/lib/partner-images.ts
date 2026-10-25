import "server-only";
import { prisma } from "./prisma";
import { fetchPartnerResource } from "./partner-import-fetch";
import { normalizePartnerImportRules, parsePartnerListing } from "./partner-import-parser";
import { parsePartnerImageDetail } from "./partner-image-parser";
import { downloadPartnerImageBytes } from "./partner-image-download";
import { partnerImageStartPageUrl, parsePartnerImageNextPage } from "./partner-image-pagination";
import { getPartnerImportErrorMessage, isPartnerImportDiagnosticCode } from "./partner-import-errors";
import { partner66fengRequest, parsePartner66fengImages, Partner66fengError } from "./partner-66feng-images";

export class PartnerImagesError extends Error {}
const fail = (message: string): never => { throw new PartnerImagesError(message); };

function safeUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f#\\]/u.test(value)) {
    return fail("请输入完整的 HTTPS 网页地址。");
  }
  let url: URL;
  try { url = new URL(value); } catch { return fail("请输入完整的 HTTPS 网页地址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return fail("仅支持不含账号、密码的 HTTPS 地址。");
  }
  return url;
}

async function selectedSource(id: number, raw: string) {
  if (!Number.isSafeInteger(id) || id < 1) fail("请先选择来源。");
  const url = safeUrl(raw);
  const source = await prisma.partnerImportSource.findUnique({
    where: { id }, select: { origin: true, rules: true, imageOrigins: true },
  });
  if (!source) return fail("来源不存在，请重新选择。");
  const origin = safeUrl(source.origin);
  if (origin.pathname !== "/" || origin.search) fail("来源配置无效，请检查网站地址。");
  if (origin.origin !== url.origin) fail("网址必须属于选定的来源网站。");
  let rules;
  let imageOrigins: string[];
  try {
    rules = normalizePartnerImportRules(JSON.parse(source.rules));
    if (source.imageOrigins.length > 4096) throw new Error();
    const values: unknown = JSON.parse(source.imageOrigins);
    if (!Array.isArray(values) || values.length > 10) throw new Error();
    imageOrigins = values.map(value => {
      if (typeof value !== "string") throw new Error();
      const imageOrigin = safeUrl(value);
      if (imageOrigin.pathname !== "/" || imageOrigin.search) throw new Error();
      return imageOrigin.origin;
    });
  } catch { return fail("来源配置无效，请检查采集规则、翻页配置和图片域名。"); }
  return { url: url.href, origin: origin.origin, rules, imageOrigins };
}

async function readPage(url: string, origin: string, signal: AbortSignal) {
  const page = await fetchPartnerResource(url, [origin], { accept: "html", maxBytes: 2_000_000, signal });
  try {
    const charset = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(page.contentType)?.[1] ?? "utf-8";
    return { html: new TextDecoder(charset, { fatal: true }).decode(page.bytes), url: page.url };
  } catch { return fail("页面编码无法识别，请检查来源网站。"); }
}

export function partnerImagesMessage(error: unknown): string {
  if (error instanceof PartnerImagesError) return error.message;
  if (error instanceof Partner66fengError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (code === "NO_PHOTOS") return "未找到图片，请检查图片选择器；本工具不执行目标网站的脚本。";
  if (code === "INVALID_IMAGE") return "图片无法安全解码，请确认来源提供有效图片。";
  if (code === "INVALID_PAGINATION") return "翻页规则无效，请检查来源的翻页配置。";
  if (code === "AMBIGUOUS_PAGINATION") return "找到多个不同的下一页地址，请为此来源配置明确的下一页选择器。";
  if (code === "UNSAFE_PAGINATION") return "下一页地址不属于当前来源的安全 HTTPS 网页，已停止翻页。";
  if (code === "PAGINATION_LOOP") return "下一页重复指向已读取页面，已停止翻页，请检查来源规则。";
  return isPartnerImportDiagnosticCode(code)
    ? getPartnerImportErrorMessage(code, status)
    : "获取图片未完成，请检查网址、图片域名和网络后重试。";
}

/** Only source configuration is read; no imported posts, drafts or jobs are created. */
export async function planPartnerImagePages(id: number, rawUrl: string, mode: "list" | "detail"): Promise<string[]> {
  return (await planPartnerImageBatch(id, rawUrl, mode)).urls;
}

/** Read one list per action so the browser can pause, resume and report each page. */
export async function planPartnerImageBatch(id: number, rawUrl: string, mode: "list" | "detail" | "three", pageNumber = 1): Promise<{
  urls: string[]; pageUrl: string; nextPageUrl: string | null; photoHints?: Record<string, string[]>;
}> {
  if (mode !== "list" && mode !== "detail" && mode !== "three") fail("请选择当前列表页、前3页或单篇文章。");
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > (mode === "three" ? 3 : 1)) {
    fail("一次最多读取前三页，请从第一页重新开始。");
  }
  const source = await selectedSource(id, rawUrl);
  if (mode === "detail") return { urls: [source.url], pageUrl: source.url, nextPageUrl: null };
  let api = partner66fengRequest(rawUrl);
  if (api && mode === "three" && pageNumber === 1) {
    const first = new URL(api.pageUrl);
    first.searchParams.set("page", "1");
    api = partner66fengRequest(first.href);
  }
  if (api) {
    const response = await fetchPartnerResource(api.apiUrl, [source.origin], {
      accept: "json", jsonBody: JSON.stringify(api.jsonBody), maxBytes: 1_500_000, signal: AbortSignal.timeout(25_000),
    });
    let json: string;
    try { json = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes); }
    catch { return fail("来源列表数据编码无效，请稍后重试。"); }
    const planned = parsePartner66fengImages(json, api.pageUrl);
    return { ...planned, nextPageUrl: mode === "three" && pageNumber < 3 ? planned.nextPageUrl : null };
  }
  const start = safeUrl(mode === "three" && pageNumber === 1 ? partnerImageStartPageUrl(source.url, source.rules) : source.url);
  if (start.origin !== source.origin) fail("翻页规则必须属于选定的来源网站。");
  const page = await readPage(start.href, source.origin, AbortSignal.timeout(25_000));
  const pageUrl = safeUrl(page.url);
  if (pageUrl.origin !== source.origin) fail("列表页必须属于选定的来源网站。");
  const urls = parsePartnerListing(page.html, pageUrl.href, source.rules);
  const next = mode === "three" && pageNumber < 3
    ? parsePartnerImageNextPage(page.html, pageUrl.href, source.rules, (pageNumber + 1) as 2 | 3) : null;
  if (next && safeUrl(next).origin !== source.origin) fail("下一页必须属于选定的来源网站。");
  return { urls, pageUrl: pageUrl.href, nextPageUrl: next };
}

/** Results are returned to the authenticated browser, never stored in public or private media folders. */
export async function collectPartnerPageImages(id: number, rawUrl: string, photoHints?: unknown) {
  const source = await selectedSource(id, rawUrl);
  const signal = AbortSignal.timeout(60_000);
  const allowedOrigins = [source.origin, ...source.imageOrigins];
  let photoUrls: string[];
  if (photoHints !== undefined) {
    if (!Array.isArray(photoHints) || photoHints.length > 8) return fail("图片地址无效，请检查来源和图片域名。");
    if (!photoHints.length) return fail("没有找到可下载的帖子图片。");
    photoUrls = [];
    for (let index = 0; index < photoHints.length; index += 1) {
      const value: unknown = photoHints[index];
      try {
        if (typeof value !== "string") throw new Error();
        const url = safeUrl(value);
        const authority = value.slice(value.indexOf("://") + 3).split(/[/?]/u, 1)[0];
        if (authority.includes("@") || !allowedOrigins.includes(url.origin)) throw new Error();
        photoUrls.push(url.href);
      } catch { fail("图片地址无效，请检查来源和图片域名。"); }
    }
  } else {
    const page = await readPage(source.url, source.origin, signal);
    photoUrls = parsePartnerImageDetail(page.html, page.url, source.rules).photoUrls;
  }
  const photos = await downloadPartnerImageBytes(photoUrls, allowedOrigins, { signal });
  return photos.map(photo => ({ base64: photo.bytes.toString("base64"), hash: photo.hash }));
}
