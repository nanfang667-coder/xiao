"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createImportJob, getImportProgress, PartnerImportError, processImportStep, retryImportJob, reviewImportDraft, saveImportSource } from "@/lib/partner-import";
import { deleteImportDrafts } from "@/lib/partner-import-delete";
import { deleteImportJob } from "@/lib/partner-import-job-delete";
import { addImportImageOrigins, detectImportImageOrigins } from "@/lib/partner-import-origins";
import type { ImportActionState, ImportProgress } from "@/lib/partner-import-types";

const ROOT = "/adminzhangzhang/partner-import";
function safeMessage(error: unknown) {
  return error instanceof PartnerImportError ? error.message : "操作未完成，请稍后重试；如反复失败，请检查配置。";
}

export async function savePartnerSource(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  try {
    await saveImportSource(form);
    revalidatePath(ROOT);
    return { message: "来源配置已保存。" };
  } catch (error) { return { error: safeMessage(error) }; }
}

export async function startPartnerImport(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  try {
    const jobId = await createImportJob(form);
    revalidatePath(ROOT);
    return { jobId };
  } catch (error) { return { error: safeMessage(error) }; }
}

const failedProgress = (error: unknown): ImportProgress => ({
  total: 0, queued: 0, processing: 0, imported: 0, skipped: 0, failed: 0, done: false, error: safeMessage(error),
});

export async function runPartnerImportStep(jobId: string): Promise<ImportProgress> {
  await requireAdmin();
  try { return await processImportStep(jobId); }
  catch (error) { return failedProgress(error); }
}

export async function retryPartnerImport(jobId: string): Promise<ImportProgress> {
  await requireAdmin();
  try { return await retryImportJob(jobId); }
  catch (error) { return failedProgress(error); }
}

export async function readPartnerImportProgress(jobId: string): Promise<ImportProgress> {
  await requireAdmin();
  try { return await getImportProgress(jobId); }
  catch (error) { return failedProgress(error); }
}

export async function reviewPartnerDraft(id: number, version: number, _previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  let result: ImportActionState;
  try { result = await reviewImportDraft(id, version, form); }
  catch (error) { return { error: safeMessage(error) }; }
  revalidatePath(ROOT);
  revalidatePath(ROOT + "/drafts/" + id);
  if (result.teacherId) {
    revalidatePath("/", "layout");
    revalidatePath("/adminzhangzhang/teachers");
    revalidatePath("/sitemap.xml");
  }
  return result;
}

export async function detectPartnerImageOrigins(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  try { return { imageOriginCheck: await detectImportImageOrigins(form) }; }
  catch (error) { return { error: safeMessage(error) }; }
}

export async function allowPartnerImageOrigins(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  try {
    const imageOriginsSaved = await addImportImageOrigins(form);
    revalidatePath(ROOT);
    return { imageOriginsSaved, message: "图片域名已保存。请重新建立同一列表页的导入任务，以使用新的配置获取原图。" };
  } catch (error) { return { error: safeMessage(error) }; }
}

export async function deletePartnerDrafts(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  let result: ImportActionState;
  try { result = await deleteImportDrafts(form); }
  catch (error) { return { error: safeMessage(error) }; }
  revalidatePath(ROOT);
  for (const id of result.deletedDraftIds ?? []) revalidatePath(ROOT + "/drafts/" + id);
  return result;
}

export async function deletePartnerImportJob(form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  let result: ImportActionState;
  try { result = await deleteImportJob(form); }
  catch (error) { return { error: safeMessage(error) }; }
  revalidatePath(ROOT);
  if (result.deletedJobId) revalidatePath(ROOT + "/jobs/" + result.deletedJobId);
  return result;
}
