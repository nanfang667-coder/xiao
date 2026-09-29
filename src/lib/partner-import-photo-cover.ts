// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { SITE_URL } from "./site-config.ts";

export type PartnerPhotoCover = {
  text: string;
  position: "top" | "bottom";
  align: "left" | "center" | "right";
  widthPercent: number;
  heightPercent: number;
};

export const DEFAULT_PARTNER_PHOTO_COVER: PartnerPhotoCover = {
  text: new URL(SITE_URL).host,
  position: "bottom",
  align: "center",
  widthPercent: 100,
  heightPercent: 15,
};

const COVER_KEYS = ["text", "position", "align", "widthPercent", "heightPercent"] as const;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function invalidCover(): never {
  throw new Error("INVALID_PHOTO_COVER");
}

function validCoverText(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > 100 ||
      !/^[\x21-\x7e]+$/.test(value) || /[<>"'\\]/.test(value)) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && DOMAIN.test(url.hostname) &&
      // Bare text must be a domain; paths, ports and queries require an explicit URL.
      (/^https?:\/\//i.test(value) || value.toLowerCase() === url.hostname);
  } catch {
    return false;
  }
}

export function parsePartnerPhotoCover(value: unknown): PartnerPhotoCover | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCover();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidCover();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== COVER_KEYS.length ||
      Object.keys(record).some((key) => !COVER_KEYS.includes(key as typeof COVER_KEYS[number])) ||
      !validCoverText(record.text) ||
      (record.position !== "top" && record.position !== "bottom") ||
      (typeof record.align !== "string" || !["left", "center", "right"].includes(record.align)) ||
      !Number.isInteger(record.widthPercent) || Number(record.widthPercent) < 25 || Number(record.widthPercent) > 100 ||
      !Number.isInteger(record.heightPercent) || Number(record.heightPercent) < 5 || Number(record.heightPercent) > 40) invalidCover();
  return {
    text: record.text,
    position: record.position,
    align: record.align as PartnerPhotoCover["align"],
    widthPercent: record.widthPercent as number,
    heightPercent: record.heightPercent as number,
  };
}

export function readPartnerPhotoCover(fieldsJson: string, useDefaultWhenMissing = false): PartnerPhotoCover | null {
  try {
    const fields: unknown = JSON.parse(fieldsJson);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) invalidCover();
    // Only absent settings get the new pending-draft default; explicit null stays off.
    if (!Object.hasOwn(fields, "_photoCover") && useDefaultWhenMissing) {
      return { ...DEFAULT_PARTNER_PHOTO_COVER };
    }
    return parsePartnerPhotoCover((fields as Record<string, unknown>)._photoCover);
  } catch {
    invalidCover();
  }
}

export function parsePartnerPhotoCoverForm(form: FormData, storedFields: string): PartnerPhotoCover | null {
  if (!form.has("photoCover")) return readPartnerPhotoCover(storedFields, true);
  const entries = form.getAll("photoCover");
  if (entries.length !== 1 || typeof entries[0] !== "string" || entries[0].length > 512) invalidCover();
  try {
    return parsePartnerPhotoCover(JSON.parse(entries[0]));
  } catch {
    invalidCover();
  }
}
