import sharp from "sharp";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { parsePartnerPhotoCover, type PartnerPhotoCover } from "./partner-import-photo-cover.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

// Private originals remain untouched; callers decide when the returned derivative is persisted.
export async function renderPartnerPhotoCover(input: Buffer, config: PartnerPhotoCover): Promise<Buffer> {
  const cover = parsePartnerPhotoCover(config);
  if (!cover) throw new Error("INVALID_PHOTO_COVER");
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_IMAGE_BYTES) {
    throw new Error("INVALID_PHOTO_COVER_IMAGE");
  }
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning", sequentialRead: true });
    const metadata = await pipeline.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) ||
        !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1 ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error();
    const swapsDimensions = metadata.orientation !== undefined && [5, 6, 7, 8].includes(metadata.orientation);
    const width = swapsDimensions ? metadata.height : metadata.width;
    const height = swapsDimensions ? metadata.width : metadata.height;
    const boxWidth = Math.max(1, Math.round(width * cover.widthPercent / 100));
    const boxHeight = Math.max(1, Math.round(height * cover.heightPercent / 100));
    const left = cover.align === "left" ? 0 : cover.align === "right" ? width - boxWidth : Math.floor((width - boxWidth) / 2);
    const top = cover.position === "top" ? 0 : height - boxHeight;
    // Use an upper bound on ASCII glyph width so even long W/M-heavy domains fit.
    const fontSize = Math.min(boxHeight * 0.44, boxWidth * 0.86 / (cover.text.length * 1.15));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="0 0 ${boxWidth} ${boxHeight}"><rect width="100%" height="100%" fill="#172033"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff">${escapeXml(cover.text)}</text></svg>`;
    return await pipeline.rotate().flatten({ background: "#ffffff" })
      .composite([{ input: Buffer.from(svg), left, top, blend: "over" }])
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  } catch {
    // Decoder errors can contain embedded metadata; do not return those details.
    throw new Error("INVALID_PHOTO_COVER_IMAGE");
  }
}
