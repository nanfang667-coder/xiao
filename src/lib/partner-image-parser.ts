// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { parsePartnerImageUrls, type PartnerImportRules } from "./partner-import-parser.ts";

/** A read-only image view; no imported post fields, drafts or publication. */
export function parsePartnerImageDetail(html: string, detailUrl: string, rules: PartnerImportRules): { photoUrls: string[] } {
  return { photoUrls: parsePartnerImageUrls(html, detailUrl, rules) };
}
