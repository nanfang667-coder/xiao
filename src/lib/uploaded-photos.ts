import { unlink } from "node:fs/promises";
import path from "node:path";

const SAFE_UPLOAD_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

export function isSafeUploadedPhotoFilename(filename: string): boolean {
  return SAFE_UPLOAD_FILENAME.test(filename) && SAFE_IMAGE_EXTENSION.test(filename);
}

export async function deleteUploadedPhotos(photosJson: string): Promise<void> {
  let photos: unknown;
  try {
    photos = JSON.parse(photosJson);
  } catch {
    return;
  }

  if (!Array.isArray(photos)) return;

  await Promise.all(
    photos.map(async (photo) => {
      if (typeof photo !== "string" || !photo.startsWith("/uploads/")) return;
      const filename = photo.slice("/uploads/".length);
      if (!SAFE_UPLOAD_FILENAME.test(filename)) return;
      try {
        await unlink(path.join(process.cwd(), "public", "uploads", filename));
      } catch {
        // Missing files are already in the desired state.
      }
    }),
  );
}
