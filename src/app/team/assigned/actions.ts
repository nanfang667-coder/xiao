"use server";

import { revalidatePath } from "next/cache";
import { requireTeamAccount } from "@/lib/team-auth";
import { PartnerImportError } from "@/lib/partner-import";
import { saveAssignedImportDraft } from "@/lib/partner-import-assignment";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import type { ImportActionState } from "@/lib/partner-import-types";

export async function saveAssignedPartnerDraft(
  id: number,
  version: number,
  _previous: ImportActionState,
  form: FormData,
): Promise<ImportActionState> {
  const account = await requireTeamAccount();
  if (!(await isPartnerImportAssignmentReady())) return { error: "团队分配功能尚未启用，请联系管理员。" };
  let result;
  try {
    result = await saveAssignedImportDraft(account.id, id, version, form);
  } catch (error) {
    return { error: error instanceof PartnerImportError ? error.message : "保存失败，请刷新页面后重试。" };
  }
  revalidatePath("/team");
  revalidatePath("/team/assigned");
  revalidatePath("/team/assigned/" + id);
  revalidatePath("/adminzhangzhang/partner-import");
  revalidatePath("/adminzhangzhang/submissions");
  return {
    message: result.message,
    version: result.version,
    submissionId: result.submissionId,
    submitted: form.get("intent") === "submit",
  };
}
