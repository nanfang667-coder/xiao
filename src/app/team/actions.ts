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
import {
  getEffectiveTeamMonthlyPostLimit,
  getTeamMonthlyPostUsageWhere,
} from "@/lib/team-post-quota";

class TeamPostQuotaExceededError extends Error {}

export async function teamLogin(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = await getClientIp();

  if (!username || !password) {
    redirect("/team/login?error=1");
  }
  if (ip !== "unknown" && !checkRateLimit(`team-login:${ip}`, 10, 15 * 60 * 1000)) {
    redirect("/team/login?error=rate-limit");
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

export async function createTeamTeacherSubmission(requestId: string, formData: FormData) {
  const account = await requireTeamAccount();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("Invalid submission request");
  }
  const submissionKey = `${account.id}:${requestId}`;
  const alreadySubmitted = () => prisma.teacherSubmission.findUnique({
    where: { submissionKey },
    select: { id: true },
  });
  if (await alreadySubmitted()) redirect("/team/posts?submitted=1");
  let uploaded: string[] = [];
  let failure: "generic" | "quota" | null = null;

  try {
    const now = new Date();
    const quotaWhere = getTeamMonthlyPostUsageWhere(account.id, now);
    const effectivePostLimit = getEffectiveTeamMonthlyPostLimit(account, now);
    const currentUsage = await prisma.teacherSubmission.count({
      where: quotaWhere,
    });
    if (currentUsage >= effectivePostLimit) {
      throw new TeamPostQuotaExceededError();
    }

    const fields = extractTeacherPostFields(formData);
    uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));
    const photos = uploaded.length > 0 ? uploaded : defaultGradients(fields.type);

    await prisma.$transaction(async (tx) => {
      const latestUsage = await tx.teacherSubmission.count({
        where: quotaWhere,
      });
      if (latestUsage >= effectivePostLimit) {
        throw new TeamPostQuotaExceededError();
      }
      await tx.teacherSubmission.create({
        select: { id: true },
        data: {
          ...fields,
          submissionKey,
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
    // A concurrent retry may have committed while this request was uploading.
    // The unique database key is the final guard, even across server processes.
    if (await alreadySubmitted()) failure = null;
  }

  if (failure) redirect(`/team/posts/new?error=${failure}`);
  revalidatePath("/team");
  revalidatePath("/team/posts");
  redirect("/team/posts?submitted=1");
}
