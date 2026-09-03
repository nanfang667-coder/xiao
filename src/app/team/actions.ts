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

function parsePhotos(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((photo): photo is string => typeof photo === "string")
      : [];
  } catch {
    return [];
  }
}

async function deleteDraftOnlyPhotos(
  draftPhotosJson: string | undefined,
  protectedPhotosJson?: string,
) {
  if (!draftPhotosJson) return;
  const protectedPhotos = new Set(parsePhotos(protectedPhotosJson ?? "[]"));
  const removable = parsePhotos(draftPhotosJson).filter(
    (photo) => !protectedPhotos.has(photo),
  );
  await deleteUploadedPhotos(JSON.stringify(removable));
}

export async function createTeamTeacherSubmission(formData: FormData) {
  const account = await requireTeamAccount();
  let uploaded: string[] = [];
  let failed = false;

  try {
    const pendingCreates = await prisma.teacherSubmission.count({
      where: {
        teamAccountId: account.id,
        kind: "create",
        status: "pending",
      },
    });
    if (pendingCreates >= 50) throw new Error("too many pending submissions");

    const fields = extractTeacherPostFields(formData);
    uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));
    const photos = uploaded.length > 0 ? uploaded : defaultGradients(fields.type);

    await prisma.teacherSubmission.create({
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
  } catch {
    failed = true;
    if (uploaded.length > 0) {
      await deleteUploadedPhotos(JSON.stringify(uploaded));
    }
  }

  if (failed) redirect("/team/posts/new?error=1");
  revalidatePath("/team");
  revalidatePath("/team/posts");
  redirect("/team/posts?submitted=1");
}

export async function updateTeamTeacherSubmission(
  teacherId: number,
  formData: FormData,
) {
  const account = await requireTeamAccount();
  let uploaded: string[] = [];
  let oldDraftPhotos: string | undefined;
  let protectedPhotos: string | undefined;
  let failed = false;

  try {
    const ownership = await prisma.teacherOwnership.findFirst({
      where: { teacherId, teamAccountId: account.id },
      include: { teacher: true },
    });
    if (!ownership) throw new Error("post not owned by account");

    const existingPending = await prisma.teacherSubmission.findFirst({
      where: {
        teacherId,
        teamAccountId: account.id,
        kind: "update",
        status: "pending",
      },
      orderBy: { updatedAt: "desc" },
    });
    const fields = extractTeacherPostFields(formData);
    uploaded = await saveUploadedPhotos(getSelectedPhotoFiles(formData));
    const photos =
      uploaded.length > 0
        ? uploaded
        : parsePhotos(existingPending?.photos ?? ownership.teacher.photos);
    oldDraftPhotos = existingPending?.photos;
    protectedPhotos = ownership.teacher.photos;

    await prisma.$transaction(async (tx) => {
      await tx.teacherSubmission.deleteMany({
        where: {
          teacherId,
          teamAccountId: account.id,
          kind: "update",
          status: "pending",
        },
      });
      await tx.teacherSubmission.create({
        data: {
          ...fields,
          kind: "update",
          status: "pending",
          teamAccountId: account.id,
          siteId: account.siteId,
          teacherId,
          photos: JSON.stringify(photos),
          emoji: emojiFor(fields.type),
        },
      });
    });
  } catch {
    failed = true;
    if (uploaded.length > 0) {
      await deleteUploadedPhotos(JSON.stringify(uploaded));
    }
  }

  if (failed) redirect(`/team/posts/${teacherId}/edit?error=1`);
  if (uploaded.length > 0) {
    await deleteDraftOnlyPhotos(oldDraftPhotos, protectedPhotos);
  }
  revalidatePath("/team/posts");
  redirect("/team/posts?submitted=1");
}
