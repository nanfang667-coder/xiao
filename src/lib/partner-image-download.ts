import { createHash } from "node:crypto";
import sharp, { type Sharp, type SharpOptions } from "sharp";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { fetchPartnerResource, PartnerFetchError } from "./partner-import-fetch.ts";

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const DECODER_OPTIONS: SharpOptions = { failOn: "warning", limitInputPixels: 25_000_000, sequentialRead: true };

export class PartnerImageDownloadError extends Error {
  readonly code: "NO_PHOTOS" | "DETAIL_LIMIT" | "TOO_LARGE" | "INVALID_IMAGE";

  constructor(code: PartnerImageDownloadError["code"]) {
    super(code === "NO_PHOTOS" ? "没有找到可下载的帖子图片。"
      : code === "DETAIL_LIMIT" ? "单篇帖子最多获取 8 张图片。"
      : code === "TOO_LARGE" ? "单张图片不能超过 5MB，单篇图片合计不能超过 12MB。"
      : "图片无法安全解码，仅支持 JPEG、PNG 和 WebP。");
    this.name = "PartnerImageDownloadError";
    this.code = code;
  }
}

export type PartnerDownloadedImage = { bytes: Buffer; hash: string };
type DownloadOptions = { signal?: AbortSignal };
type ResourceFetcher = typeof fetchPartnerResource;

function checkActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new PartnerFetchError("TIMEOUT");
}

async function decode<T>(pipeline: Sharp, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    checkActive(signal);
    const result = await new Promise<T>((resolve, reject) => {
      abort = () => { pipeline.destroy(); reject(new PartnerFetchError("TIMEOUT")); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else operation().then(resolve, reject);
    });
    checkActive(signal);
    return result;
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    pipeline.destroy();
  }
}

async function normalize(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  try {
    const input = sharp(bytes, DECODER_OPTIONS).timeout({ seconds: 5 });
    const metadata = await decode(input, () => input.metadata(), signal);
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) throw new PartnerImageDownloadError("INVALID_IMAGE");
    const output = sharp(bytes, DECODER_OPTIONS).timeout({ seconds: 5 })
      .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true });
    return await decode(output, () => output.toBuffer(), signal);
  } catch (error) {
    checkActive(signal);
    if (error instanceof PartnerImageDownloadError) throw error;
    throw new PartnerImageDownloadError("INVALID_IMAGE");
  }
}

/** Injectable transport keeps tests offline; no filesystem, database or publication. */
export function createPartnerImageDownloader(fetchResource: ResourceFetcher) {
  return async (urls: string[], allowedOrigins: string[], options: DownloadOptions = {}): Promise<PartnerDownloadedImage[]> => {
    checkActive(options.signal);
    if (!Array.isArray(urls) || urls.length > MAX_PHOTOS || urls.some(url => typeof url !== "string")) {
      throw new PartnerImageDownloadError("DETAIL_LIMIT");
    }
    if (!urls.length) throw new PartnerImageDownloadError("NO_PHOTOS");
    const images: PartnerDownloadedImage[] = [];
    let inputBytes = 0;
    let outputBytes = 0;
    for (const url of urls) {
      checkActive(options.signal);
      const resource = await fetchResource(url, allowedOrigins, {
        accept: "image", maxBytes: MAX_PHOTO_BYTES, signal: options.signal,
      });
      checkActive(options.signal);
      inputBytes += resource.bytes.length;
      if (!resource.bytes.length || resource.bytes.length > MAX_PHOTO_BYTES || inputBytes > MAX_TOTAL_BYTES) {
        throw new PartnerImageDownloadError("TOO_LARGE");
      }
      const bytes = await normalize(resource.bytes, options.signal);
      outputBytes += bytes.length;
      if (bytes.length > MAX_PHOTO_BYTES || outputBytes > MAX_TOTAL_BYTES) throw new PartnerImageDownloadError("TOO_LARGE");
      images.push({ bytes, hash: createHash("sha256").update(bytes).digest("hex") });
    }
    return images;
  };
}

export const downloadPartnerImageBytes = createPartnerImageDownloader(fetchPartnerResource);
