import "server-only";

import { prisma } from "@/lib/prisma";
import {
  alleyAdminPhotoUrl,
  alleyMemberPhotoUrl,
  parseAlleyPhotoNames,
} from "@/lib/alley-media";

export type AlleyListItem = {
  id: number;
  title: string;
  city: string;
  district: string;
  address: string;
  coverPhoto: string;
  createdAt: Date;
};

export type AlleyPublicDetail = {
  id: number;
  title: string;
  city: string;
  district: string;
  address: string;
};

export type AlleyMemberDetail = {
  description: string;
  detailPhotos: string[];
};

export type AlleyAdmin = AlleyListItem &
  AlleyMemberDetail & {
    sortOrder: number;
    isPublished: boolean;
    updatedAt: Date;
  };

function numericId(id: string): number | null {
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function getPublishedAlleys(): Promise<AlleyListItem[]> {
  return prisma.alleyPost.findMany({
    where: { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      city: true,
      district: true,
      address: true,
      coverPhoto: true,
      createdAt: true,
    },
  });
}

export async function getPublishedAlleyPublicById(
  id: string,
): Promise<AlleyPublicDetail | null> {
  const parsedId = numericId(id);
  if (!parsedId) return null;

  return prisma.alleyPost.findFirst({
    where: { id: parsedId, isPublished: true },
    select: {
      id: true,
      title: true,
      city: true,
      district: true,
      address: true,
    },
  });
}

export async function getPublishedAlleyMemberDetailById(
  id: number,
): Promise<AlleyMemberDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const row = await prisma.alleyPost.findFirst({
    where: { id, isPublished: true },
    select: { description: true, detailPhotos: true },
  });
  if (!row) return null;

  return {
    description: row.description,
    detailPhotos: parseAlleyPhotoNames(row.detailPhotos).map((filename) =>
      alleyMemberPhotoUrl(id, filename),
    ),
  };
}

export async function publishedAlleyHasDetailPhoto(
  id: number,
  filename: string,
): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;

  const row = await prisma.alleyPost.findFirst({
    where: { id, isPublished: true },
    select: { detailPhotos: true },
  });
  return row ? parseAlleyPhotoNames(row.detailPhotos).includes(filename) : false;
}

export async function getAlleysForAdmin(): Promise<AlleyAdmin[]> {
  const rows = await prisma.alleyPost.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map((row) => ({
    ...row,
    detailPhotos: parseAlleyPhotoNames(row.detailPhotos).map(
      alleyAdminPhotoUrl,
    ),
  }));
}

export async function getAlleyByIdForAdmin(
  id: string,
): Promise<AlleyAdmin | null> {
  const parsedId = numericId(id);
  if (!parsedId) return null;

  const row = await prisma.alleyPost.findUnique({ where: { id: parsedId } });
  if (!row) return null;

  return {
    ...row,
    detailPhotos: parseAlleyPhotoNames(row.detailPhotos).map(
      alleyAdminPhotoUrl,
    ),
  };
}
