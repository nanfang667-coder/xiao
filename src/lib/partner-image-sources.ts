import "server-only";
import { prisma } from "./prisma";
import { normalizePartnerImportRules } from "./partner-import-parser";

export class PartnerSourceError extends Error {}
const fail = (message: string): never => { throw new PartnerSourceError(message); };

function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail("无效的记录编号。");
  return id;
}

function originValue(value: string): string {
  const raw = value.trim();
  if (!raw || raw.length > 2048) return fail("请输入有效的 HTTPS 网址。");
  let url: URL;
  try { url = new URL(raw); } catch { return fail("请输入有效的 HTTPS 网址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return fail("仅支持不含账号、密码或片段的 HTTPS 网址。");
  }
  if (url.pathname !== "/" || url.search) fail("来源地址只填写域名，例如 https://partner.example。");
  return url.origin;
}

export async function savePartnerImageSource(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) fail("请填写 1–80 字的来源名称。");
  const origin = originValue(String(form.get("origin") ?? ""));
  const rawImages = String(form.get("imageOrigins") ?? "");
  if (rawImages.length > 4096) fail("图片域名配置过长。");
  const imageOrigins = [...new Set(rawImages.split(/[\n,]+/).map(value => value.trim()).filter(Boolean).map(originValue))];
  if (imageOrigins.length > 10) fail("最多配置 10 个图片域名。");
  let rules;
  try {
    const raw = String(form.get("rules") ?? "").trim();
    if (raw.length > 16000) throw new Error();
    rules = normalizePartnerImportRules(raw ? JSON.parse(raw) : {});
  } catch { return fail("采集规则格式不正确，请检查高级配置。"); }
  const data = { name, rules: JSON.stringify(rules), imageOrigins: JSON.stringify(imageOrigins) };
  if (form.get("sourceId")) {
    const id = positiveId(form.get("sourceId"));
    const source = await prisma.partnerImportSource.findUnique({ where: { id } });
    if (!source || source.origin !== origin) fail("修改配置不能更换来源域名，请为新网站单独添加来源。");
    await prisma.partnerImportSource.update({ where: { id }, data });
  } else {
    if (await prisma.partnerImportSource.findUnique({ where: { origin } })) fail("此来源已存在，请编辑已有配置。");
    await prisma.partnerImportSource.create({ data: { ...data, origin } });
  }
}
