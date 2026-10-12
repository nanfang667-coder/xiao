"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { PartnerImportError } from "@/lib/partner-import";
import { reviewAssignedImportDraft } from "@/lib/partner-import-assignment";
import type { ImportActionState } from "@/lib/partner-import-types";

export async function finalizeAssignedImport(submissionId: number, version: number, _previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  await requireAdmin();
  const intent = form.get("intent");
  if (intent !== "approve" && intent !== "return") return { error: "请选择终审操作。" };
  let result;
  try {
    result = await reviewAssignedImportDraft(submissionId, intent, String(form.get("reviewNote") ?? ""), version);
  } catch (error) {
    return { error: error instanceof PartnerImportError ? error.message : "终审未完成，请刷新后重试。" };
  }
  for (const path of ["/adminzhangzhang/partner-import", "/adminzhangzhang/submissions", "/team", "/team/posts", "/team/assigned"]) revalidatePath(path);
  revalidatePath("/adminzhangzhang/partner-import/drafts/" + result.draftId);
  revalidatePath("/team/assigned/" + result.draftId);
  if (result.teacherId) {
    revalidatePath("/", "layout");
    revalidatePath("/adminzhangzhang/teachers");
    revalidatePath("/sitemap.xml");
  }
  return { message: result.message, teacherId: result.teacherId, version: version + 1 };
}
