import { extractTeacherPostFields } from "./teacher-post-input";
import { cleanPartnerImportFields } from "./partner-import-declarations";
import { parsePartnerPhotoCover } from "./partner-import-photo-cover";

export const TRANSFER_FORMAT = "partner-drafts-v1";
export const MAX_TRANSFER_LINE_BYTES = 18 * 1024 * 1024;
export const MAX_TRANSFER_POSTS = 50;
const FIELD_NAMES = ["name", "type", "city", "district", "price", "services", "courseNotes", "age", "phone", "wechat", "qq", "otherContact", "address"] as const;

export function parseTransferRecord(input: unknown, origin: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_TRANSFER");
  const record = input as Record<string, unknown>;
  if (record.format !== TRANSFER_FORMAT || record.kind !== "post" || record.origin !== origin ||
      typeof record.sourceUrl !== "string" || record.sourceUrl.length > 2048 ||
      /[\s\\#]/u.test(record.sourceUrl)) throw new Error("INVALID_TRANSFER");
  const url = new URL(record.sourceUrl);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new Error("INVALID_TRANSFER");
  if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) throw new Error("INVALID_TRANSFER");
  const raw = record.fields as Record<string, unknown>;
  const form = new FormData();
  for (const key of FIELD_NAMES) {
    if (raw[key] != null && typeof raw[key] !== "string") throw new Error("INVALID_TRANSFER");
    form.set(key, String(raw[key] ?? ""));
  }
  const fields = extractTeacherPostFields(form, { requireContact: false });
  fields.type = raw.type === "舞蹈" ? "舞蹈" : "钢琴";
  const cleaned = cleanPartnerImportFields(fields);
  if (!cleaned.name || !cleaned.services) throw new Error("INVALID_TRANSFER");
  const cover = parsePartnerPhotoCover(record.cover);
  if (!Array.isArray(record.photos) || record.photos.length > 8) throw new Error("INVALID_TRANSFER");
  let total = 0;
  const photos = record.photos.map(value => {
    if (typeof value !== "string" || !value.length || value.length > 7 * 1024 * 1024 ||
        value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("INVALID_TRANSFER");
    const bytes = Buffer.from(value, "base64");
    total += bytes.length;
    if (bytes.length > 5 * 1024 * 1024 || total > 12 * 1024 * 1024 ||
        bytes.toString("base64") !== value) throw new Error("INVALID_TRANSFER");
    return bytes;
  });
  return { sourceUrl: url.href, fields: cleaned, cover, photos };
}

export async function readTransferBody(request: Request): Promise<unknown> {
  if (!request.body || request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("INVALID_TRANSFER");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_TRANSFER_LINE_BYTES)) throw new Error("INVALID_TRANSFER");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TRANSFER_LINE_BYTES) throw new Error("INVALID_TRANSFER");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
