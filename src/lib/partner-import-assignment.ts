import "server-only";
import { prisma } from "./prisma";
import { requirePartnerImportAssignmentReady, PartnerImportAssignmentUnavailableError, PARTNER_ASSIGNMENT_UNAVAILABLE } from "./partner-import-assignment-readiness";
import { PartnerImportError, publishReviewedPartnerDraft } from "./partner-import";
import { extractTeacherPostFields, type TeacherPostFields } from "./teacher-post-input";
import { cleanPartnerImportFields } from "./partner-import-declarations";
import { parsePartnerPhotoKeys, removePartnerPrivatePhotos } from "./partner-import-photos";
import { readPartnerPhotoCover, type PartnerPhotoCover } from "./partner-import-photo-cover";
import { getEffectiveTeamPostLimit, getTeamPostUsageWhere } from "./team-post-quota";
import { emojiFor } from "./photo";

const ACTIVE_STATES = ["ready", "assigned", "returned", "submitted"];
const CHANGED = "稿件状态或版本已变化，请刷新列表后重新操作。";
const ACCOUNT_DISABLED = "成员账号或所属站点已停用，请重新选择有效账号。";

function fail(message: string): never { throw new PartnerImportError(message); }
function positiveId(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d{0,15}$/.test(String(value))) fail("无效的记录编号。");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail("无效的记录编号。");
  return number;
}
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    await requirePartnerImportAssignmentReady();
    return await operation();
  }
  catch (error) {
    if (error instanceof PartnerImportError) throw error;
    if (error instanceof PartnerImportAssignmentUnavailableError) return fail(PARTNER_ASSIGNMENT_UNAVAILABLE);
    return fail("操作未完成，请刷新页面后重试。");
  }
}
function selectedDrafts(form: FormData) {
  const entries = form.getAll("draft");
  if (!entries.length || entries.length > 20) fail("每次请选择 1–20 篇稿件。");
  const ids = new Set<number>();
  return entries.map(value => {
    if (typeof value !== "string" || !/^[1-9]\d{0,15}:[1-9]\d{0,15}$/.test(value)) fail("选中项无效，请刷新后重新选择。");
    const [id, version] = value.split(":").map(positiveId);
    if (ids.has(id)) fail("选中项重复，请刷新后重新选择。");
    ids.add(id);
    return { id, version };
  });
}
function unpublishedPost(draftId: number) {
  return { teacherId: null, revision: 0, drafts: { none: { id: { not: draftId }, status: { in: ACTIVE_STATES } } } };
}

export async function approveImportDrafts(form: FormData): Promise<{ message: string; draftIds: number[] }> {
  return guarded(async () => {
    const selected = selectedDrafts(form);
    await prisma.$transaction(async tx => {
      const rows = await tx.partnerImportDraft.findMany({
        where: { id: { in: selected.map(row => row.id) } },
        select: { id: true, version: true, status: true, teamAccountId: true, postId: true },
      });
      const versionsByPost = new Map<number, number>();
      for (const row of rows) {
        const previous = versionsByPost.get(row.postId);
        if (previous !== undefined) fail("草稿 #" + previous + " 和 #" + row.id + " 来自同一原帖，请只选择其中一个版本。本次所选草稿均未通过初审。");
        versionsByPost.set(row.postId, row.id);
      }
      for (const selection of selected) {
        const row = rows.find(value => value.id === selection.id);
        if (!row) fail("草稿 #" + selection.id + " 已不存在，请刷新列表。本次所选草稿均未通过初审。");
        if (row.status !== "pending" || row.version !== selection.version || row.teamAccountId !== null) {
          fail("草稿 #" + row.id + " 的状态或版本已变化，请刷新列表后重新选择。本次所选草稿均未通过初审。");
        }
        const changed = await tx.partnerImportDraft.updateMany({
          where: { ...selection, status: "pending", teamAccountId: null, post: unpublishedPost(row.id) },
          data: { status: "ready", reviewedAt: new Date(), version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          // Diagnose only a rejected claim, using metadata from this transaction.
          // Never select titles, field JSON, photos or source URLs for errors.
          const post = await tx.partnerImportedPost.findUnique({
            where: { id: row.postId },
            select: {
              teacherId: true, revision: true,
              drafts: {
                where: { id: { not: row.id }, status: { in: ACTIVE_STATES } },
                orderBy: { id: "desc" }, take: 1, select: { id: true, status: true },
              },
            },
          });
          const prefix = "草稿 #" + row.id + "：";
          const unchanged = "本次所选草稿均未通过初审。";
          if (post?.teacherId != null) fail(prefix + "原帖已发布，不能作为新稿重复分配；请在已发布帖子中管理。" + unchanged);
          if (post && post.revision !== 0) fail(prefix + "原帖有历史发布记录，不能作为新稿重复分配；请由管理员审查处理。" + unchanged);
          const other = post?.drafts[0];
          if (other) {
            const stage = ({ ready: "待分配", assigned: "成员处理中", returned: "退回修改", submitted: "待终审" } as Record<string, string>)[other.status] ?? "分配流程中";
            fail(prefix + "同一原帖的其他版本 #" + other.id + " 已在“" + stage + "”，请继续处理该版本。" + unchanged);
          }
          fail(prefix + "状态或版本已变化，请刷新列表后重新选择。" + unchanged);
        }
      }
    });
    return { message: "初审通过，已移至待分配区。", draftIds: selected.map(row => row.id) };
  });
}

export async function assignImportDrafts(form: FormData): Promise<{ message: string; draftIds: number[] }> {
  return guarded(async () => {
    const selected = selectedDrafts(form);
    const accountValues = form.getAll("teamAccountId");
    if (accountValues.length !== 1) fail("请选择一个有效的成员账号。");
    const teamAccountId = positiveId(accountValues[0]);
    await prisma.$transaction(async tx => {
      const account = await tx.teamAccount.findFirst({
        where: { id: teamAccountId, isActive: true, site: { isActive: true } }, select: { id: true },
      });
      if (!account) fail(ACCOUNT_DISABLED);
      for (const selection of selected) {
        const changed = await tx.partnerImportDraft.updateMany({
          where: { ...selection, status: "ready", teamAccountId: null, post: unpublishedPost(selection.id) },
          data: { status: "assigned", teamAccountId, version: { increment: 1 } },
        });
        if (changed.count !== 1) fail(CHANGED);
      }
    });
    return { message: "已分配给成员，等待编辑提交。", draftIds: selected.map(row => row.id) };
  });
}

function editableFields(form: FormData, requireContact: boolean, storedFields: string): { fields: TeacherPostFields; cover: PartnerPhotoCover | null } {
  try {
    const stored = JSON.parse(storedFields);
    const cleaned = new FormData();
    for (const [key, value] of form.entries()) {
      cleaned.append(key, typeof value === "string" ? cleanPartnerImportFields({ [key]: value })[key] : value);
    }
    const fields = extractTeacherPostFields(cleaned, { requireContact });
    fields.type = stored && ["钢琴", "舞蹈"].includes(stored.type) ? stored.type : "钢琴";
    return { fields, cover: readPartnerPhotoCover(storedFields, true) };
  } catch {
    return fail(requireContact
      ? "请填写标题、服务内容和至少一种联系方式，并检查字段长度。"
      : "请填写标题、服务内容，并检查字段长度及图片设置。");
  }
}

function selectedPhotos(form: FormData, photos: string) {
  const allPhotos = parsePartnerPhotoKeys(photos);
  const values = form.getAll("keepPhotos");
  if (values.length > 8 || values.some(value => typeof value !== "string" || !allPhotos.includes(value))) fail("图片选择无效，请刷新后重试。");
  return { allPhotos, keepPhotos: [...new Set(values as string[])] };
}

export async function saveAssignedImportDraft(
  accountValue: number, idValue: number, versionValue: number, form: FormData,
): Promise<{ message: string; version: number; submissionId?: number }> {
  return guarded(async () => {
    const accountId = positiveId(accountValue);
    const id = positiveId(idValue);
    const version = positiveId(versionValue);
    const intent = form.get("intent");
    if (intent !== "save" && intent !== "submit") fail("请选择保存或提交审核。");
    const outcome = await prisma.$transaction(async tx => {
      const account = await tx.teamAccount.findFirst({
        where: { id: accountId, isActive: true, site: { isActive: true } },
        select: { id: true, siteId: true, monthlyPostLimit: true, monthlyPostLimitOverride: true, monthlyPostBonus: true, monthlyPostBonusMonth: true },
      });
      if (!account) fail(ACCOUNT_DISABLED);
      const draft = await tx.partnerImportDraft.findUnique({ where: { id } });
      if (!draft || draft.teamAccountId !== accountId || draft.version !== version || !["assigned", "returned"].includes(draft.status)) fail(CHANGED);
      const { fields, cover } = editableFields(form, intent === "submit", draft.fields);
      const { allPhotos, keepPhotos } = selectedPhotos(form, draft.photos);
      const changed = await tx.partnerImportDraft.updateMany({
        where: { id, version, teamAccountId: accountId, status: draft.status, post: unpublishedPost(id) },
        data: {
          status: intent === "submit" ? "submitted" : draft.status,
          fields: JSON.stringify({ ...fields, _photoCover: cover }),
          photos: JSON.stringify(keepPhotos), version: { increment: 1 },
        },
      });
      if (changed.count !== 1) fail(CHANGED);
      let submissionId: number | undefined;
      if (intent === "submit") {
        const now = new Date();
        const used = await tx.teacherSubmission.count({ where: getTeamPostUsageWhere(accountId) });
        if (used >= getEffectiveTeamPostLimit(account)) fail("发帖额度已用完，请联系管理员增加额度后再提交。");
        const existing = await tx.teacherSubmission.findUnique({ where: { partnerImportDraftId: id } });
        const data = {
          ...fields, kind: "create", status: "pending", teamAccountId: accountId, siteId: account.siteId,
          partnerImportDraftId: id, teacherId: null, photos: "[]", emoji: emojiFor(fields.type),
          reviewNote: null, reviewedAt: null, createdAt: now,
        };
        if (existing) {
          const resubmitted = await tx.teacherSubmission.updateMany({
            where: { id: existing.id, partnerImportDraftId: id, teamAccountId: accountId, kind: "create", status: "rejected", teacherId: null },
            data,
          });
          if (resubmitted.count !== 1) fail(CHANGED);
          submissionId = existing.id;
        } else {
          const submission = await tx.teacherSubmission.create({ data: { ...data, submissionKey: "partner-import:" + id } });
          submissionId = submission.id;
        }
      }
      return { allPhotos, keepPhotos, submissionId };
    });
    let failed = 0;
    try { failed = await removePartnerPrivatePhotos(outcome.allPhotos.filter(key => !outcome.keepPhotos.includes(key))); }
    catch { failed = 1; }
    const message = intent === "submit" ? "已提交终审，通过后才会公开发布。" : "已保存，仍由你编辑。";
    return { message: message + (failed ? "部分取消的私有照片清理未完成。" : ""), version: version + 1, ...(outcome.submissionId ? { submissionId: outcome.submissionId } : {}) };
  });
}

export async function reviewAssignedImportDraft(
  submissionValue: number, intent: "approve" | "return", note: string | undefined, expectedVersionValue: number,
): Promise<{ message: string; draftId: number; teacherId?: number }> {
  return guarded(async () => {
    const submissionId = positiveId(submissionValue);
    const expectedVersion = positiveId(expectedVersionValue);
    if (intent !== "approve" && intent !== "return") fail("请选择通过终审或退回修改。");
    if (note !== undefined && (typeof note !== "string" || note.length > 300)) fail("审核说明最多填写 300 字。");
    const submission = await prisma.teacherSubmission.findUnique({
      where: { id: submissionId }, include: { partnerImportDraft: { include: { post: true } } },
    });
    const draft = submission?.partnerImportDraft;
    if (!submission || !draft || submission.status !== "pending" || submission.kind !== "create" ||
        draft.status !== "submitted" || draft.version !== expectedVersion || draft.teamAccountId !== submission.teamAccountId) fail(CHANGED);
    if (intent === "return") {
      await prisma.$transaction(async tx => {
        const account = await tx.teamAccount.findFirst({
          where: { id: submission.teamAccountId, siteId: submission.siteId, isActive: true, site: { isActive: true } }, select: { id: true },
        });
        if (!account) fail(ACCOUNT_DISABLED);
        const returned = await tx.partnerImportDraft.updateMany({
          where: { id: draft.id, version: expectedVersion, status: "submitted", teamAccountId: submission.teamAccountId },
          data: { status: "returned", version: { increment: 1 } },
        });
        if (returned.count !== 1) fail(CHANGED);
        const reviewed = await tx.teacherSubmission.updateMany({
          where: { id: submissionId, partnerImportDraftId: draft.id, status: "pending", teamAccountId: submission.teamAccountId },
          data: { status: "rejected", reviewNote: note?.trim() || "请修改后重新提交。", reviewedAt: new Date() },
        });
        if (reviewed.count !== 1) fail(CHANGED);
      });
      return { message: "已退回成员修改，本次提交额度已释放。", draftId: draft.id };
    }
    if (draft.post.teacherId !== null || draft.post.revision !== 0) fail("此原帖已发布或版本已变化，无法重复发布。");
    const stored: unknown = JSON.parse(draft.fields);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) fail("稿件字段无效，请退回成员检查。");
    const form = new FormData();
    for (const [key, value] of Object.entries(stored)) if (typeof value === "string") form.set(key, value);
    const { fields, cover } = editableFields(form, true, draft.fields);
    const photos = parsePartnerPhotoKeys(draft.photos);
    const published = await publishReviewedPartnerDraft({
      id: draft.id, version: expectedVersion, postId: draft.postId, sourceId: draft.post.sourceId,
      reviewedRevision: 0, fields, photoCover: cover, allPhotos: photos, keepPhotos: photos,
      assignment: { submissionId, teamAccountId: submission.teamAccountId, siteId: submission.siteId },
    });
    return { message: "终审通过，已发布并归属该成员。", draftId: draft.id, teacherId: published.teacherId };
  });
}
