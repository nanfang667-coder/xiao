"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { PartnerImportError } from "@/lib/partner-import";
import { approveImportDrafts, assignImportDrafts } from "@/lib/partner-import-assignment";
import type { ImportActionState } from "@/lib/partner-import-types";

function assignmentResult(result: { message: string; draftIds: number[] }): ImportActionState {
  let refreshFailed = false;
  const paths = [
    "/adminzhangzhang/partner-import", "/team", "/team/assigned", "/adminzhangzhang/submissions",
    ...result.draftIds.map(id => "/adminzhangzhang/partner-import/drafts/" + id),
  ];
  // The transaction has committed. A cache refresh failure must not report that
  // approval/assignment failed or invite the user to repeat the mutation.
  for (const path of paths) {
    try { revalidatePath(path); }
    catch { refreshFailed = true; }
  }
  return {
    message: result.message + (refreshFailed ? "列表刷新未完成，请手动刷新页面查看最新状态。" : ""),
    updatedDraftIds: result.draftIds,
  };
}

export async function approvePartnerDrafts(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  let result;
  try { result = await approveImportDrafts(form); }
  catch (error) {
    return { error: error instanceof PartnerImportError ? error.message : "同意未完成，请刷新页面确认最新状态后重试。" };
  }
  return assignmentResult(result);
}

export async function assignPartnerDrafts(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  let result;
  try { result = await assignImportDrafts(form); }
  catch (error) {
    return { error: error instanceof PartnerImportError ? error.message : "分配未完成，请刷新页面确认最新状态后重试。" };
  }
  return assignmentResult(result);
}
