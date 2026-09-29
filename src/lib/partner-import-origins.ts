import "server-only";
import { prisma } from "./prisma";
import { PartnerImportError } from "./partner-import";
import { fetchPartnerResource } from "./partner-import-fetch";
import { normalizePartnerImportRules, parsePartnerDetail, parsePartnerListing } from "./partner-import-parser";
import { getPartnerImportErrorMessage, isPartnerImportDiagnosticCode } from "./partner-import-errors";
import type { ImportImageOriginCheck } from "./partner-import-types";

const fail = (message: string): never => { throw new PartnerImportError(message); };
const MAX_ORIGINS = 10;

function sourceId(form: FormData): number {
  const id = Number(form.get("sourceId"));
  if (!Number.isSafeInteger(id) || id < 1) fail("请选择有效的合作方来源。");
  return id;
}

function safeUrl(raw: string): URL {
  if (!raw || raw.length > 2048 || /[\s\u0000-\u001f\u007f#\\]/u.test(raw)) return fail("请输入有效的 HTTPS 网址。");
  let url: URL;
  try { url = new URL(raw); } catch { return fail("请输入有效的 HTTPS 网址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")
    || raw.slice(raw.indexOf("://") + 3).split(/[/?]/u, 1)[0].includes("@")) {
    return fail("仅支持不含账号、密码或片段的 HTTPS 网址。");
  }
  return url;
}

function imageOrigin(raw: string): string {
  const url = safeUrl(raw);
  if (url.pathname !== "/" || url.search) fail("图片域名应为完整的 HTTPS 网站地址，不包含路径或参数。");
  return url.origin;
}

function storedOrigins(raw: string): string[] {
  try {
    if (raw.length > 4096) throw new Error();
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > MAX_ORIGINS || values.some(value => typeof value !== "string")) throw new Error();
    return [...new Set((values as string[]).map(imageOrigin))];
  } catch { return fail("已有图片域名配置无效，请先检查来源的高级配置。"); }
}

function selectedList(raw: string, origin: string): URL {
  const url = safeUrl(raw);
  if (url.origin !== origin) fail("列表网址必须属于选定的来源域名。");
  return url;
}

function safeFailure(error: unknown, fallback: string): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return fail(getPartnerImportErrorMessage(isPartnerImportDiagnosticCode(code) ? code : fallback, status));
}

async function readPage(url: string, origin: string) {
  let page: Awaited<ReturnType<typeof fetchPartnerResource>>;
  try { page = await fetchPartnerResource(url, [origin], { accept: "html" }); }
  catch (error) { return safeFailure(error, "CONNECT_FAILED"); }
  try {
    const charset = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(page.contentType)?.[1] ?? "utf-8";
    return { html: new TextDecoder(charset, { fatal: true }).decode(page.bytes), url: page.url };
  } catch { return fail(getPartnerImportErrorMessage("HTML_ENCODING")); }
}

/** Reads at most three current-list details. It never downloads photos or writes import data. */
export async function detectImportImageOrigins(form: FormData): Promise<ImportImageOriginCheck> {
  const id = sourceId(form);
  const source = await prisma.partnerImportSource.findUnique({
    where: { id }, select: { id: true, origin: true, rules: true, imageOrigins: true },
  });
  if (!source) return fail("请先添加或选择合作方来源。");
  const rawList = String(form.get("listUrl") ?? "").trim();
  const list = selectedList(rawList, source.origin);
  const known = new Set([source.origin, ...storedOrigins(source.imageOrigins)]);
  let rules;
  try { rules = normalizePartnerImportRules(JSON.parse(source.rules)); }
  catch { return fail(getPartnerImportErrorMessage("INVALID_RULES")); }
  const page = await readPage(list.href, source.origin);
  let links: string[];
  try { links = parsePartnerListing(page.html, page.url, rules); }
  catch (error) { return safeFailure(error, "LISTING_NO_MATCH"); }
  if (!links.length) return fail(getPartnerImportErrorMessage("LISTING_NO_MATCH"));
  const origins = new Set<string>();
  let sampled = 0;
  let failed = 0;
  let photoCount = 0;
  for (const link of links.slice(0, 3)) {
    try {
      const detail = await readPage(link, source.origin);
      const parsed = parsePartnerDetail(detail.html, detail.url, rules);
      const candidateOrigins = parsed.photoUrls.map(value => safeUrl(value).origin);
      for (const origin of candidateOrigins) if (!known.has(origin)) origins.add(origin);
      photoCount += candidateOrigins.length;
      sampled++;
    } catch { failed++; }
  }
  if (sampled === 0) return fail("抽检详情页未能完成，请检查连接和采集规则后重试。");
  const combined = [...new Set([...known, ...origins])].filter(origin => origin !== source.origin);
  if (JSON.stringify(combined).length > 4096) fail("图片域名配置过长，请在高级配置中调整。");
  if (combined.length > MAX_ORIGINS) fail("检测结果与已有配置合计超过 10 个图片域名，请检查采集规则或在高级配置中调整。");
  return { sourceId: id, listUrl: rawList, origins: [...origins].sort(), sampled, failed, photoCount };
}

/** Only an explicit administrator submission may extend the download allowlist. */
export async function addImportImageOrigins(form: FormData) {
  const id = sourceId(form);
  if (form.get("allowImageOrigins") !== "yes") fail("请确认允许从列出的图片域名下载照片。");
  const submitted = form.getAll("imageOrigin");
  if (submitted.length < 1 || submitted.length > MAX_ORIGINS || submitted.some(value => typeof value !== "string")) {
    return fail("请选择 1–10 个有效的图片域名。");
  }
  const additions = [...new Set((submitted as string[]).map(imageOrigin))];
  const rawList = String(form.get("listUrl") ?? "").trim();
  // Compare-and-swap prevents a concurrent configuration update being lost.
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await prisma.partnerImportSource.findUnique({
      where: { id }, select: { origin: true, imageOrigins: true },
    });
    if (!source) return fail("请先添加或选择合作方来源。");
    selectedList(rawList, source.origin);
    const merged = [...new Set([...storedOrigins(source.imageOrigins), ...additions])].filter(origin => origin !== source.origin);
    if (JSON.stringify(merged).length > 4096) fail("图片域名配置过长，请在高级配置中调整。");
    if (merged.length > MAX_ORIGINS) fail("最多配置 10 个图片域名，请先在高级配置中调整。");
    const result = await prisma.partnerImportSource.updateMany({
      where: { id, imageOrigins: source.imageOrigins }, data: { imageOrigins: JSON.stringify(merged) },
    });
    if (result.count) return { sourceId: id, listUrl: rawList };
  }
  return fail("来源配置同时发生了变更，请重新检测后保存。");
}
