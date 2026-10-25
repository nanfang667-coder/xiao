"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { PartnerSourceError, savePartnerImageSource } from "@/lib/partner-image-sources";
import type { ImportActionState } from "@/lib/partner-import-types";

export async function savePartnerSource(_previous: ImportActionState, form: FormData): Promise<ImportActionState> {
  void _previous;
  await requireAdmin();
  try {
    await savePartnerImageSource(form);
    revalidatePath("/adminzhangzhang/partner-import");
    return { message: "来源配置已保存。" };
  } catch (error) {
    return { error: error instanceof PartnerSourceError ? error.message : "来源配置未保存，请检查后重试。" };
  }
}
