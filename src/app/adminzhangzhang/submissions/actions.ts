"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteUploadedPhotos } from "@/lib/uploaded-photos";

function approvedTeacherData(submission: {
  name: string;
  type: string;
  city: string;
  district: string;
  price: string;
  services: string;
  courseNotes: string | null;
  age: string | null;
  photos: string;
  emoji: string;
  phone: string;
  wechat: string;
  qq: string | null;
  otherContact: string | null;
  address: string | null;
}) {
  return {
    name: submission.name,
    type: submission.type,
    city: submission.city,
    district: submission.district,
    price: submission.price,
    services: submission.services,
    courseNotes: submission.courseNotes,
    age: submission.age,
    photos: submission.photos,
    emoji: submission.emoji,
    phone: submission.phone,
    wechat: submission.wechat,
    qq: submission.qq,
    otherContact: submission.otherContact,
    address: submission.address,
  };
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

async function deleteReplacedPhotos(oldPhotosJson: string, newPhotosJson: string) {
  const retained = new Set(parsePhotos(newPhotosJson));
  const removed = parsePhotos(oldPhotosJson).filter((photo) => !retained.has(photo));
  await deleteUploadedPhotos(JSON.stringify(removed));
}

export async function approveTeacherSubmission(submissionId: number) {
  await requireAdmin();

  const replacedPhotos = await prisma.$transaction(async (tx) => {
    const submission = await tx.teacherSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission || submission.status !== "pending") return null;

    if (submission.kind === "create") {
      const teacher = await tx.teacher.create({
        data: approvedTeacherData(submission),
      });
      await tx.teacherOwnership.create({
        data: {
          teacherId: teacher.id,
          teamAccountId: submission.teamAccountId,
        },
      });
      await tx.teacherSubmission.update({
        where: { id: submission.id },
        data: {
          status: "approved",
          teacherId: teacher.id,
          reviewedAt: new Date(),
          reviewNote: null,
        },
      });
      return null;
    }

    if (submission.kind !== "update" || !submission.teacherId) {
      throw new Error("Invalid submission type");
    }
    const ownership = await tx.teacherOwnership.findUnique({
      where: { teacherId: submission.teacherId },
      include: { teacher: true },
    });
    if (!ownership || ownership.teamAccountId !== submission.teamAccountId) {
      throw new Error("Submission ownership mismatch");
    }
    const photoReplacement = {
      old: ownership.teacher.photos,
      next: submission.photos,
    };
    await tx.teacher.update({
      where: { id: submission.teacherId },
      data: approvedTeacherData(submission),
    });
    await tx.teacherSubmission.update({
      where: { id: submission.id },
      data: { status: "approved", reviewedAt: new Date(), reviewNote: null },
    });
    return photoReplacement;
  });

  if (replacedPhotos) {
    await deleteReplacedPhotos(replacedPhotos.old, replacedPhotos.next);
  }
  revalidatePath("/");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/teachers");
  revalidatePath("/adminzhangzhang/submissions");
  revalidatePath("/team");
  revalidatePath("/team/posts");
}

export async function rejectTeacherSubmission(
  submissionId: number,
  formData: FormData,
) {
  await requireAdmin();
  const note = String(formData.get("reviewNote") ?? "").trim().slice(0, 300) || null;
  const submission = await prisma.teacherSubmission.findUnique({
    where: { id: submissionId },
    select: {
      status: true,
      kind: true,
      photos: true,
      teacher: { select: { photos: true } },
    },
  });
  if (!submission || submission.status !== "pending") return;

  const protectedPhotos = new Set(parsePhotos(submission.teacher?.photos ?? "[]"));
  const draftOnlyPhotos = parsePhotos(submission.photos).filter(
    (photo) => !protectedPhotos.has(photo),
  );
  const updated = await prisma.teacherSubmission.updateMany({
    where: { id: submissionId, status: "pending" },
    data: {
      status: "rejected",
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });
  if (updated.count > 0 && draftOnlyPhotos.length > 0) {
    await deleteUploadedPhotos(JSON.stringify(draftOnlyPhotos));
  }
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/submissions");
  revalidatePath("/team");
  revalidatePath("/team/posts");
}
