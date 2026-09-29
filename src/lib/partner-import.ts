import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { isPartnerImportAssignmentReady, PARTNER_ASSIGNMENT_UNAVAILABLE } from "./partner-import-assignment-readiness";
import { fetchPartnerResource } from "./partner-import-fetch";
import { normalizePartnerImportRules, parsePartnerDetail, parsePartnerListing } from "./partner-import-parser";
import { downloadPartnerPhotos, parsePartnerPhotoKeys, publishPartnerPhotos, removePartnerPrivatePhotos } from "./partner-import-photos";
import { deleteUploadedPhotos } from "./uploaded-photos";
import { extractTeacherPostFields, type TeacherPostFields } from "./teacher-post-input";
import { cleanPartnerImportFields } from "./partner-import-declarations";
import { DEFAULT_PARTNER_PHOTO_COVER, parsePartnerPhotoCoverForm, type PartnerPhotoCover } from "./partner-import-photo-cover";
import { defaultGradients, emojiFor } from "./photo";
import type { ImportProgress } from "./partner-import-types";
import { getPartnerImportErrorMessage, isPartnerImportDiagnosticCode } from "./partner-import-errors";

export class PartnerImportError extends Error {}
const fail = (message: string): never => { throw new PartnerImportError(message); };
const LEASE_MS = 10 * 60 * 1000;

// Only allowlisted codes and a validated numeric HTTP status leave this boundary.
function diagnosticCode(error: unknown, fallback = "IMPORT_FAILED"): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return isPartnerImportDiagnosticCode(code) ? String(code) : fallback;
}

function diagnosticMessage(error: unknown, fallback: string): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return getPartnerImportErrorMessage(diagnosticCode(error, fallback), status);
}

function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail("无效的记录编号。");
  return id;
}

function jobIdValue(id: string) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) fail("无效的任务编号。");
  return id;
}

function safeUrl(value: string): URL {
  if (!value || value.length > 2048) return fail("请输入有效的 HTTPS 网址。");
  let url: URL;
  try { url = new URL(value); } catch { return fail("请输入有效的 HTTPS 网址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return fail("仅支持不含账号、密码或片段的 HTTPS 网址。");
  }
  return url;
}

function originValue(value: string) {
  const url = safeUrl(value.trim());
  if (url.pathname !== "/" || url.search) fail("来源地址只填写域名，例如 https://partner.example。");
  return url.origin;
}

export async function saveImportSource(form: FormData) {
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

export async function createImportJob(form: FormData) {
  const source = await prisma.partnerImportSource.findUnique({ where: { id: positiveId(form.get("sourceId")) } });
  if (!source) return fail("请先添加或选择合作方来源。");
  const listUrl = safeUrl(String(form.get("listUrl") ?? "").trim());
  if (listUrl.origin !== source.origin) fail("列表网址必须属于选定的来源域名。");
  let rules;
  try { rules = normalizePartnerImportRules(JSON.parse(source.rules)); }
  catch { return fail(getPartnerImportErrorMessage("INVALID_RULES")); }
  let page: Awaited<ReturnType<typeof fetchPartnerResource>>;
  try { page = await fetchPartnerResource(listUrl.href, [source.origin], { accept: "html" }); }
  catch (error) { return fail(diagnosticMessage(error, "CONNECT_FAILED")); }
  let html: string;
  try { html = decodeHtml(page.bytes, page.contentType); }
  catch { return fail(getPartnerImportErrorMessage("HTML_ENCODING")); }
  let links: string[];
  try { links = parsePartnerListing(html, page.url, rules); }
  catch (error) { return fail(diagnosticMessage(error, "LISTING_NO_MATCH")); }
  if (links.length === 0) fail(getPartnerImportErrorMessage("LISTING_NO_MATCH"));
  if (links.length > 50) fail("单页最多支持 50 条帖子，请使用更小的分页。");
  // Store a fixed list and rule snapshot: processing never follows pagination.
  const job = await prisma.partnerImportJob.create({
    data: {
      sourceId: source.id, listUrl: listUrl.href, rules: source.rules, imageOrigins: source.imageOrigins,
      items: { create: links.map(sourceUrl => ({ sourceUrl })) },
    }, select: { id: true },
  });
  return job.id;
}

function decodeHtml(bytes: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  return new TextDecoder(charset, { fatal: true }).decode(bytes);
}

export async function getImportProgress(id: string): Promise<ImportProgress> {
  jobIdValue(id);
  const job = await prisma.partnerImportJob.findUnique({ where: { id }, select: { id: true } });
  if (!job) return fail("导入任务不存在。");
  const rows = await prisma.partnerImportItem.groupBy({ by: ["status", "errorCode"], where: { jobId: id }, _count: { _all: true } });
  const count = (status: string) => rows.filter(row => row.status === status).reduce((sum, row) => sum + row._count._all, 0);
  const failures = new Map<string, number>();
  for (const row of rows.filter(row => row.status === "failed")) {
    const code = isPartnerImportDiagnosticCode(row.errorCode) ? String(row.errorCode) : "IMPORT_FAILED";
    failures.set(code, (failures.get(code) ?? 0) + row._count._all);
  }
  const result = {
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
    queued: count("queued"), processing: count("processing"), imported: count("imported"),
    skipped: count("skipped"), failed: count("failed"),
  };
  return { ...result, done: result.queued + result.processing === 0, failures: [...failures].map(([code, count]) => ({ code, count })) };
}

export async function recoverExpiredItems(id: string) {
  await prisma.partnerImportItem.updateMany({
    where: { jobId: id, status: "processing", lockedAt: { lt: new Date(Date.now() - LEASE_MS) } },
    data: { status: "queued", lockedAt: null, lockToken: null },
  });
}

export async function retryImportJob(id: string) {
  jobIdValue(id);
  await recoverExpiredItems(id);
  await prisma.partnerImportItem.updateMany({
    where: { jobId: id, status: "failed" },
    data: { status: "queued", errorCode: null, lockedAt: null, lockToken: null },
  });
  return getImportProgress(id);
}

export async function processImportStep(id: string): Promise<ImportProgress> {
  jobIdValue(id);
  await recoverExpiredItems(id);
  const item = await prisma.partnerImportItem.findFirst({
    where: { jobId: id, status: "queued" }, orderBy: { id: "asc" }, include: { job: { include: { source: true } } },
  });
  if (!item) return getImportProgress(id);
  const lockToken = randomUUID();
  const claimed = await prisma.partnerImportItem.updateMany({
    where: { id: item.id, status: "queued" },
    data: { status: "processing", lockedAt: new Date(), lockToken, errorCode: null },
  });
  if (!claimed.count) return getImportProgress(id);

  let privateKeys: string[] = [];
  let keepFiles = false;
  let failureStage = "CONNECT_FAILED";
  try {
    const origin = item.job.source.origin;
    const detail = await fetchPartnerResource(item.sourceUrl, [origin], { accept: "html" });
    failureStage = "HTML_ENCODING";
    const html = decodeHtml(detail.bytes, detail.contentType);
    failureStage = "INVALID_RULES";
    const rules = normalizePartnerImportRules(JSON.parse(item.job.rules));
    failureStage = "DETAIL_MISSING_FIELDS";
    const parsed = parsePartnerDetail(html, detail.url, rules);
    failureStage = "IMPORT_FAILED";
    const photos = await downloadPartnerPhotos(parsed.photoUrls, [origin, ...JSON.parse(item.job.imageOrigins) as string[]]);
    privateKeys = photos.keys;
    const contentHash = createHash("sha256").update(JSON.stringify({ fields: parsed.fields, photos: photos.hashes })).digest("hex");

    const outcome = await prisma.$transaction(async tx => {
      // A timed-out worker cannot commit after a retry acquired a new lease.
      const active = await tx.partnerImportItem.updateMany({
        where: { id: item.id, status: "processing", lockToken },
        data: { status: "imported", lockedAt: null, lockToken: null },
      });
      if (!active.count) return "lost";
      const post = await tx.partnerImportedPost.upsert({
        where: { sourceId_sourceUrl: { sourceId: item.job.sourceId, sourceUrl: detail.url } },
        create: { sourceId: item.job.sourceId, sourceUrl: detail.url }, update: {},
      });
      const existing = await tx.partnerImportDraft.findUnique({ where: { postId_contentHash: { postId: post.id, contentHash } }, select: { id: true } });
      if (existing) {
        await tx.partnerImportItem.update({ where: { id: item.id }, data: { status: "skipped", draftId: existing.id } });
        return "skipped";
      }
      const draft = await tx.partnerImportDraft.create({
        data: { postId: post.id, contentHash, baseRevision: post.revision, fields: JSON.stringify({ ...parsed.fields, _photoCover: DEFAULT_PARTNER_PHOTO_COVER }), photos: JSON.stringify(privateKeys) },
        select: { id: true },
      });
      await tx.partnerImportItem.update({ where: { id: item.id }, data: { draftId: draft.id } });
      return "imported";
    });
    keepFiles = outcome === "imported";
  } catch (error) {
    // Never persist exception messages, response bodies, titles or credentials.
    await prisma.partnerImportItem.updateMany({
      where: { id: item.id, status: "processing", lockToken },
      data: { status: "failed", errorCode: diagnosticCode(error, failureStage), lockedAt: null, lockToken: null },
    });
  } finally {
    if (!keepFiles) await removePartnerPrivatePhotos(privateKeys);
  }
  return getImportProgress(id);
}

export async function reviewImportDraft(idValue: number, versionValue: number, form: FormData) {
  const id = positiveId(idValue);
  const version = positiveId(versionValue);
  const intent = String(form.get("intent") ?? "");
  if (!["save", "publish", "reject"].includes(intent)) return fail("请选择审核操作。");
  const assignmentReady = await isPartnerImportAssignmentReady();
  const draft = await prisma.partnerImportDraft.findUnique({ where: { id }, select: {
    id: true, status: true, version: true, postId: true, baseRevision: true, fields: true, photos: true,
    ...(assignmentReady ? { teamAccountId: true as const } : {}),
    post: { select: { sourceId: true, revision: true } },
  } });
  if (!draft || draft.status !== "pending" || draft.teamAccountId != null || draft.version !== version) return fail("此待审稿已变更，请刷新页面后重新审查。");

  if (intent === "reject") {
    const changed = await prisma.partnerImportDraft.updateMany({
      where: { id, version, status: "pending" },
      data: { status: "rejected", reviewedAt: new Date(), version: { increment: 1 } },
    });
    if (!changed.count) return fail("此待审稿已变更，请刷新页面后重试。");
    return { message: "已拒绝，内容不会发布。", version: version + 1 };
  }

  const postType = String(form.get("type") ?? "");
  if (!["钢琴", "舞蹈"].includes(postType)) return fail("请选择本站支持的帖子分类。");
  let fields;
  try {
    // Clean before validation so declaration-only values cannot satisfy required fields.
    // Copy all entries to preserve duplicate photo selections and leave the submitted form intact.
    const cleanedForm = new FormData();
    for (const [key, value] of form.entries()) {
      const cleaned = typeof value === "string" ? cleanPartnerImportFields({ [key]: value })[key] : value;
      cleanedForm.append(key, cleaned);
    }
    fields = extractTeacherPostFields(cleanedForm, { requireContact: intent === "publish" });
    fields.type = postType;
  } catch {
    return fail(intent === "publish" ? "请检查字段长度，并填写标题、正文和至少一种联系方式后发布。" : "请填写标题、正文，并检查字段长度。");
  }
  let photoCover;
  try { photoCover = parsePartnerPhotoCoverForm(form, draft.fields); }
  catch { return fail("图片覆盖设置无效，请重新预览后保存。"); }
  // Private metadata stays in the draft JSON and never becomes a Teacher field.
  const draftFields = { ...fields, _photoCover: photoCover };
  const allPhotos = parsePartnerPhotoKeys(draft.photos);
  const keepPhotos = [...new Set(form.getAll("keepPhotos").map(String))];
  if (keepPhotos.some(key => !allPhotos.includes(key))) return fail("图片选择无效，请刷新后重试。");

  if (intent === "save") {
    const saved = await prisma.partnerImportDraft.updateMany({
      where: { id, version, status: "pending" },
      data: { fields: JSON.stringify(draftFields), photos: JSON.stringify(keepPhotos), version: { increment: 1 } },
    });
    if (!saved.count) return fail("此待审稿已变更，请刷新页面后重试。");
    await removePartnerPrivatePhotos(allPhotos.filter(key => !keepPhotos.includes(key)));
    return { message: "已保存，仍在待审区。", version: version + 1 };
  }

  if (form.get("confirmPublish") !== "yes") return fail("请确认已审查正文和图片，再发布。");
  const rawRevision = form.get("postRevision");
  if (typeof rawRevision !== "string" || !/^\d+$/.test(rawRevision)) return fail("缺少审核版本，请刷新页面后重新审查。");
  const reviewedRevision = Number(rawRevision);
  if (!Number.isSafeInteger(reviewedRevision) || reviewedRevision !== draft.post.revision) return fail("此原帖的公开版本已变化，请刷新后重新审查。");
  if (draft.baseRevision !== reviewedRevision && form.get("confirmReplace") !== "yes") {
    return fail("此原帖已有其他版本发布，请确认要替换后再发布。");
  }

  return publishReviewedPartnerDraft({ id, version, postId: draft.postId, sourceId: draft.post.sourceId, reviewedRevision, fields, photoCover, allPhotos, keepPhotos });
}

export async function publishReviewedPartnerDraft({ id, version, postId, sourceId, reviewedRevision, fields, photoCover, allPhotos, keepPhotos, assignment }: {
  id: number; version: number; postId: number; sourceId: number; reviewedRevision: number;
  fields: TeacherPostFields; photoCover: PartnerPhotoCover | null; allPhotos: string[]; keepPhotos: string[];
  assignment?: { submissionId: number; teamAccountId: number; siteId: string };
}) {
  const assignmentReady = await isPartnerImportAssignmentReady();
  if (assignment && !assignmentReady) return fail(PARTNER_ASSIGNMENT_UNAVAILABLE);
  const draftFields = { ...fields, _photoCover: photoCover };
  let publicPhotos: string[] = [];
  let committed = false;
  try {
    publicPhotos = await publishPartnerPhotos(keepPhotos, photoCover);
    const published = await prisma.$transaction(async tx => {
      if (assignment) {
        const account = await tx.teamAccount.findFirst({
          where: { id: assignment.teamAccountId, siteId: assignment.siteId, isActive: true, site: { isActive: true } }, select: { id: true },
        });
        if (!account) return fail("成员账号或所属站点已停用，请刷新后重试。");
        const approved = await tx.teacherSubmission.updateMany({
          where: { id: assignment.submissionId, partnerImportDraftId: id, teamAccountId: assignment.teamAccountId, siteId: assignment.siteId, kind: "create", status: "pending" },
          data: { status: "approved", reviewedAt: new Date(), reviewNote: null },
        });
        if (!approved.count) return fail("此提交已变更，请刷新页面后重新审核。");
      }
      const claimed = await tx.partnerImportDraft.updateMany({
        where: { id, version, status: assignment ? "submitted" : "pending", ...(assignment ? { teamAccountId: assignment.teamAccountId } : assignmentReady ? { teamAccountId: null } : {}) },
        data: { status: "published", fields: JSON.stringify(draftFields), photos: JSON.stringify(keepPhotos), reviewedAt: new Date(), version: { increment: 1 } },
      });
      if (!claimed.count) return fail("此待审稿已变更，请刷新页面后重新审查。");
      const postClaim = await tx.partnerImportedPost.updateMany({
        where: { id: postId, revision: reviewedRevision, ...(assignment ? { teacherId: null } : {}),
          drafts: { none: { id: { not: id }, status: { in: ["ready", "assigned", "returned", "submitted"] } } },
        },
        data: { revision: { increment: 1 } },
      });
      if (!postClaim.count) return fail("此原帖的公开版本已变化，请刷新后重新审查。");
      const data = {
        ...fields, photos: JSON.stringify(publicPhotos.length ? publicPhotos : defaultGradients(fields.type)),
        emoji: emojiFor(fields.type), source: "partner:" + sourceId, sourceId: postId,
      };
      const oldTeacher = await tx.teacher.findUnique({
        where: { source_sourceId: { source: data.source, sourceId: data.sourceId } }, select: { photos: true },
      });
      if (assignment && oldTeacher) return fail("此原帖已发布，不能重复创建成员帖子。");
      const teacher = await tx.teacher.upsert({
        where: { source_sourceId: { source: data.source, sourceId: data.sourceId } },
        create: data, update: data,
      });
      await tx.partnerImportedPost.update({ where: { id: postId }, data: { teacherId: teacher.id } });
      if (assignment) {
        await tx.teacherOwnership.create({ data: { teacherId: teacher.id, teamAccountId: assignment.teamAccountId } });
        await tx.teacherSubmission.update({ where: { id: assignment.submissionId }, data: { teacherId: teacher.id } });
      }
      return { teacherId: teacher.id, oldPhotos: oldTeacher?.photos };
    });
    committed = true;
    if (published.oldPhotos) await deleteUploadedPhotos(published.oldPhotos);
    await removePartnerPrivatePhotos(allPhotos.filter(key => !keepPhotos.includes(key)));
    return { message: "审核通过，已发布。", version: version + 1, teacherId: published.teacherId };
  } finally {
    if (!committed && publicPhotos.length) await deleteUploadedPhotos(JSON.stringify(publicPhotos));
  }
}
