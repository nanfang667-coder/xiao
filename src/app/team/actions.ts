"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  loginTeamAccount,
  logoutTeamAccount,
  requireTeamAccount,
} from "@/lib/team-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { prisma } from "@/lib/prisma";
import { defaultGradients, emojiFor } from "@/lib/photo";
import { getSelectedPhotoFiles, saveUploadedPhotos } from "@/lib/image-upload";
import { deleteUploadedPhotos } from "@/lib/uploaded-photos";
import { extractTeacherPostFields } from "@/lib/teacher-post-input";
import { getTeamMonthlyPostUsageWhere } from "@/lib/team-post-quota";

class TeamPostQuotaExceededError extends Error {}

export async function teamLogin(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await getClientIp();

  if (
    !username ||
    !password ||
    (ip !== "unknown" &&
      !checkRateLimit(`team-login:${ip}`, 10, 15 * 60 * 1000))
  ) {
    redirect("/team/login?error=1");
  }
  if (!(await loginTeamAccount(username, password))) {
    redirect("/team/login?error=1");
  }
  redirect("/team");
}

export async function teamLogout() {
  await logoutTeamAccount();
  redirect("/team/login");
}

export async function createTeamTeacherSubmission(formData: FormData) {
  const account = await requireTeamAccount();
  let uploaded: string[] = [];
  let failure: "generic" | "quota" | null = null;

  try {
    const quotaWhere = getTeamMonthlyPostUsageWhere(account.id);
    const currentUsage = await prisma.teacherSubmission.count({
      where: quotaWhere,
    });
    if (currentUsage >= account.monthlyPostLimit) {
      throw new TeamPostQuotaExceededError();
    }

    const fields = extractTeacherPostFields(formData);
    uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));
    const photos = uploaded.length > 0 ? uploaded : defaultGradients(fields.type);

    await prisma.$transaction(async (tx) => {
      const latestUsage = await tx.teacherSubmission.count({
        where: quotaWhere,
      });
      if (latestUsage >= account.monthlyPostLimit) {
        throw new TeamPostQuotaExceededError();
      }
      await tx.teacherSubmission.create({
        data: {
          ...fields,
          kind: "create",
          status: "pending",
          teamAccountId: account.id,
          siteId: account.siteId,
          photos: JSON.stringify(photos),
          emoji: emojiFor(fields.type),
        },
      });
    });
  } catch (error) {
    failure = error instanceof TeamPostQuotaExceededError ? "quota" : "generic";
    if (uploaded.length > 0) {
      await deleteUploadedPhotos(JSON.stringify(uploaded));
    }
  }

  if (failure) redirect(`/team/posts/new?error=${failure}`);
  revalidatePath("/team");
  revalidatePath("/team/posts");
  redirect("/team/posts?submitted=1");
}
