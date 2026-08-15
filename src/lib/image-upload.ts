import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_PHOTO_COUNT = 8;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 12 * 1024 * 1024;

const MAX_INPUT_PIXELS = 25_000_000;
const MAX_OUTPUT_DIMENSION = 1600;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

async function normalizeImage(file: File, index: number): Promise<Buffer> {
  if (file.size === 0) {
    throw new ImageUploadError(`第 ${index + 1} 张图片是空文件。`);
  }
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    throw new ImageUploadError(`第 ${index + 1} 张图片超过 5MB。`);
  }

  const input = Buffer.from(await file.arrayBuffer());

  try {
    const decoderOptions: sharp.SharpOptions = {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    };
    const metadata = await sharp(input, decoderOptions).metadata();

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new ImageUploadError(`第 ${index + 1} 张图片不是支持的 JPEG、PNG 或 WebP。`);
    }

    return await sharp(input, decoderOptions)
      .rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError(`第 ${index + 1} 张图片无法安全解码。`);
  }
}

export async function saveUploadedPhotos(
  files: File[],
  targetDir = path.join(process.cwd(), "public", "uploads"),
): Promise<string[]> {
  if (files.length > MAX_PHOTO_COUNT) {
    throw new ImageUploadError(`一次最多上传 ${MAX_PHOTO_COUNT} 张图片。`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_PHOTO_BYTES) {
    throw new ImageUploadError("图片总大小不能超过 12MB。");
  }

  const normalized: Buffer[] = [];
  for (const [index, file] of files.entries()) {
    // 顺序解码，避免多张高像素图片同时占用大量内存。
    normalized.push(await normalizeImage(file, index));
  }
  await mkdir(targetDir, { recursive: true });

  const writtenFiles: string[] = [];
  try {
    for (const buffer of normalized) {
      const filename = `${randomUUID()}.jpg`;
      await writeFile(path.join(targetDir, filename), buffer, { flag: "wx" });
      writtenFiles.push(filename);
    }
  } catch (error) {
    await Promise.allSettled(writtenFiles.map((filename) => unlink(path.join(targetDir, filename))));
    throw error;
  }

  return writtenFiles.map((filename) => `/uploads/${filename}`);
}