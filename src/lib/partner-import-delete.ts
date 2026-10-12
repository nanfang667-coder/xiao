import "server-only";
import { prisma } from "./prisma";
import { PartnerImportError } from "./partner-import";
import { parsePartnerPhotoKeys, removePartnerPrivatePhotos } from "./partner-import-photos";
import type { ImportActionState } from "./partner-import-types";

const changedMessage = "选中的草稿已变更或不再可删除，请刷新列表后重新选择。";

function selectedDrafts(form: FormData) {
  if (form.get("confirmDelete") !== "yes") throw new PartnerImportError("请确认删除选中的草稿及其私有照片。");
  const values = form.getAll("draft");
  if (values.length < 1 || values.length > 20) throw new PartnerImportError("每次请选择 1–20 篇草稿。");
  const ids = new Set<number>();
  return values.map(value => {
    if (typeof value !== "string" || !/^[1-9]\d{0,15}:[1-9]\d{0,15}$/.test(value)) {
      throw new PartnerImportError("选中项无效，请刷新列表后重新选择。");
    }
    const [id, version] = value.split(":").map(Number);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(version) || ids.has(id)) {
      throw new PartnerImportError("选中项无效，请刷新列表后重新选择。");
    }
    ids.add(id);
    return { id, version };
  });
}

export async function deleteImportDrafts(form: FormData): Promise<ImportActionState> {
  const selected = selectedDrafts(form);
  const ids = selected.map(draft => draft.id);
  const photoKeys = await prisma.$transaction(async tx => {
    const drafts = await tx.partnerImportDraft.findMany({
      where: { id: { in: ids } },
      select: { id: true, version: true, status: true, photos: true },
    });
    if (drafts.length !== selected.length || selected.some(selection => {
      const draft = drafts.find(row => row.id === selection.id);
      return !draft || draft.version !== selection.version || !["pending", "rejected"].includes(draft.status);
    })) throw new PartnerImportError(changedMessage);

    let keys: string[];
    try { keys = [...new Set(drafts.flatMap(draft => parsePartnerPhotoKeys(draft.photos)))]; }
    catch { throw new PartnerImportError("草稿照片记录异常，本次未删除，请检查后重试。"); }

    // A concurrent review must invalidate the whole batch, never delete a published draft.
    const deleted = await tx.partnerImportDraft.deleteMany({
      where: { OR: selected, status: { in: ["pending", "rejected"] } },
    });
    if (deleted.count !== selected.length) throw new PartnerImportError(changedMessage);
    await tx.partnerImportItem.updateMany({ where: { draftId: { in: ids } }, data: { draftId: null } });
    return keys;
  });

  // Files remain intact on rollback. Private photos are never copied to the public site here.
  let failedPhotos: number;
  try { failedPhotos = await removePartnerPrivatePhotos(photoKeys); }
  catch { failedPhotos = photoKeys.length || 1; }
  return {
    deletedDraftIds: ids,
    message: failedPhotos
      ? `已删除 ${ids.length} 篇草稿，但部分私有照片清理未完成，请联系管理员处理。`
      : `已删除 ${ids.length} 篇草稿及其私有照片。`,
  };
}
