import "server-only";

import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { saveUploadedPhotos } from "@/lib/image-upload";

export const ALLEY_DETAIL_UPLOAD_DIR = path.join(
  process.cwd(),
  "storage",
  "alley-detail",
);
const PRIVATE_PHOTO_NAME = /^[0-9a-f-]{36}\.jpg$/;

export function parseAlleyPhotoNames(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (name): name is string =>
            typeof name === "string" && PRIVATE_PHOTO_NAME.test(name),
        )
      : [];
  } catch {
    return [];
  }
}

export function alleyMemberPhotoUrl(filename: string): string {
  return `/api/alley-media/${encodeURIComponent(filename)}`;
}

export function alleyAdminPhotoUrl(filename: string): string {
  return `/adminzhangzhang/alleys/media/${encodeURIComponent(filename)}`;
}

export async function saveAlleyDetailPhotos(files: File[]): Promise<string[]> {
  const temporaryUrls = await saveUploadedPhotos(
    files,
    ALLEY_DETAIL_UPLOAD_DIR,
  );
  return temporaryUrls.map((url) => path.posix.basename(url));
}

export async function deleteAlleyDetailPhotos(
  value: string | string[],
): Promise<void> {
  const filenames = Array.isArray(value) ? value : parseAlleyPhotoNames(value);
  await Promise.allSettled(
    filenames.map((filename) =>
      unlink(path.join(ALLEY_DETAIL_UPLOAD_DIR, filename)),
    ),
  );
}

export async function readAlleyDetailPhoto(
  filename: string,
): Promise<Buffer | null> {
  if (
    !PRIVATE_PHOTO_NAME.test(filename) ||
    path.basename(filename) !== filename
  )
    return null;
  try {
    return await readFile(path.join(ALLEY_DETAIL_UPLOAD_DIR, filename));
  } catch {
    return null;
  }
}
