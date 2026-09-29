import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, copyFile, unlink, open } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { saveUploadedPhotos } from "./image-upload";
import { fetchPartnerResource } from "./partner-import-fetch";
import { parsePartnerPhotoCover, type PartnerPhotoCover } from "./partner-import-photo-cover";
import { renderPartnerPhotoCover } from "./partner-import-photo-cover-render";

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
export const partnerPrivateDirectory = () => path.join(process.cwd(), "storage", "partner-import");
export const isPartnerPhotoKey = (key: string) => KEY.test(key);

export function parsePartnerPhotoKeys(value: string): string[] {
  const keys: unknown = JSON.parse(value);
  if (!Array.isArray(keys) || keys.length > 8 || keys.some(key => typeof key !== "string" || !isPartnerPhotoKey(key))) {
    throw new Error("INVALID_PHOTOS");
  }
  return [...new Set(keys)] as string[];
}

export async function removePartnerPrivatePhotos(keys: string[]) {
  const results = await Promise.allSettled(keys.filter(isPartnerPhotoKey).map(key => unlink(path.join(partnerPrivateDirectory(), key))));
  return results.filter(result => result.status === "rejected" && result.reason?.code !== "ENOENT").length;
}

export async function downloadPartnerPhotos(urls: string[], origins: string[]) {
  if (urls.length > 8) throw new Error("TOO_MANY_PHOTOS");
  const files: File[] = [];
  const hashes: string[] = [];
  let total = 0;
  for (const url of urls) {
    const result = await fetchPartnerResource(url, origins, { accept: "image", maxBytes: 5 * 1024 * 1024 });
    total += result.bytes.length;
    if (total > 12 * 1024 * 1024) throw new Error("PHOTOS_TOO_LARGE");
    files.push(new File([new Uint8Array(result.bytes)], "source", { type: result.contentType }));
    hashes.push(createHash("sha256").update(result.bytes).digest("hex"));
  }
  const saved = await saveUploadedPhotos(files, partnerPrivateDirectory());
  return { keys: saved.map(photo => photo.slice("/uploads/".length)), hashes };
}

export async function readPartnerPrivatePhoto(key: string): Promise<Buffer> {
  if (!isPartnerPhotoKey(key)) throw new Error("INVALID_PHOTO");
  return readFile(path.join(partnerPrivateDirectory(), key));
}

// Only called after an explicit publish request, never while importing or saving a draft.
export async function publishPartnerPhotos(keys: string[], inputCover: PartnerPhotoCover | null = null): Promise<string[]> {
  if (keys.length > 8 || keys.some(key => !isPartnerPhotoKey(key))) throw new Error("INVALID_PHOTO");
  const cover = parsePartnerPhotoCover(inputCover);
  const directory = path.join(process.cwd(), "public", "uploads");
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  try {
    for (const key of keys) {
      const filename = randomUUID() + ".jpg";
      if (cover) {
        const image = await renderPartnerPhotoCover(await readPartnerPrivatePhoto(key), cover);
        const file = await open(path.join(directory, filename), "wx");
        // Track immediately after exclusive creation so partial writes are cleaned up.
        written.push("/uploads/" + filename);
        try { await file.writeFile(image); } finally { await file.close(); }
      } else {
        await copyFile(path.join(partnerPrivateDirectory(), key), path.join(directory, filename), constants.COPYFILE_EXCL);
        written.push("/uploads/" + filename);
      }
    }
    return written;
  } catch {
    await Promise.allSettled(written.map(url => unlink(path.join(directory, url.slice("/uploads/".length)))));
    throw new Error("PHOTO_PUBLISH_FAILED");
  }
}
