import "server-only";
import { prisma } from "./prisma";
import { PartnerImportError, recoverExpiredItems } from "./partner-import";

const INVALID_JOB_MESSAGE = "无效的任务编号，请刷新任务列表后重试。";
const DELETE_FAILED_MESSAGE = "任务记录删除失败，请稍后重试。";
const PROCESSING_MESSAGE = "任务仍有正在处理的条目，请先暂停导入，等待当前条目处理完成后再删除。";
const NOT_FOUND_MESSAGE = "任务记录不存在或已删除，请刷新任务列表。";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteImportJob(form: FormData): Promise<{ deletedJobId: string; message: string }> {
  const confirmations = form.getAll("confirmDelete");
  if (confirmations.length !== 1 || confirmations[0] !== "yes") {
    throw new PartnerImportError("请确认删除这条导入任务记录。");
  }
  const ids = form.getAll("jobId");
  if (ids.length !== 1 || typeof ids[0] !== "string" || !UUID.test(ids[0])) {
    throw new PartnerImportError(INVALID_JOB_MESSAGE);
  }
  const id = ids[0];
  let count: number;
  let exists = false;
  try {
    // Release expired leases with the same token invalidation used by retries.
    await recoverExpiredItems(id);
    // The relation predicate and deletion execute as one database operation.
    // A worker cannot claim an item between a separate status read and deletion.
    const deleted = await prisma.partnerImportJob.deleteMany({
      where: { id, items: { none: { status: "processing" } } },
    });
    count = deleted.count;
    if (count === 0) {
      exists = Boolean(await prisma.partnerImportJob.findUnique({
        where: { id }, select: { id: true },
      }));
    }
  } catch {
    // Database diagnostics may contain URLs or source content; never expose them.
    throw new PartnerImportError(DELETE_FAILED_MESSAGE);
  }
  if (count === 0) throw new PartnerImportError(exists ? PROCESSING_MESSAGE : NOT_FOUND_MESSAGE);
  if (count !== 1) throw new PartnerImportError(DELETE_FAILED_MESSAGE);
  // Only job items cascade. Drafts, source records, post indexes and files remain.
  return { deletedJobId: id, message: "已删除导入任务记录，待审稿、照片和已发布帖子均保留。" };
}
