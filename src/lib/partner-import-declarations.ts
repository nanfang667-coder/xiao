import type { CheerioAPI } from "cheerio";

const DECLARATION_HEADING = /^声明信息\s*[:：]?\s*$/u;
const DECLARATION_LINE = /^\s*声明信息(?:\s*[:：].*|\s*)$/u;
const TEXT_FIELDS = [
  "services", "courseNotes", "city", "district", "price", "age",
  "phone", "wechat", "qq", "otherContact", "address",
] as const;

/** Only an exact heading at a line boundary starts a declaration tail. */
export function stripPartnerDeclarationText(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  const index = lines.findIndex(line => DECLARATION_LINE.test(line));
  return index < 0 ? text : lines.slice(0, index).join("\n").trimEnd();
}

/** Copy editable text fields; names, categories, photos and metadata stay intact. */
export function cleanPartnerImportFields<T extends object>(fields: T): T {
  const result = { ...fields };
  const values = result as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    if (typeof values[key] === "string") values[key] = stripPartnerDeclarationText(values[key]);
  }
  return result;
}

type Selection = ReturnType<CheerioAPI>;

/**
 * Mutate only the caller's text DOM, never the DOM used to discover photos.
 * Structural boundaries prevent declaration examples becoming contact fields.
 */
export function removePartnerDeclarationSections($: CheerioAPI, root: Selection): void {
  const isHeading = (element: Selection) => DECLARATION_HEADING.test(element.text().trim());
  const excluded = 'nav, header, footer, aside, [role="navigation"], [hidden], [aria-hidden="true"], [data-import-ignore], [data-ad]';
  root.find("tr").each((_, node) => {
    const row = $(node);
    if (isHeading(row.children("th, td").first())) row.remove();
  });
  root.find("dt").each((_, node) => {
    const term = $(node);
    if (isHeading(term)) {
      term.nextUntil("dt").remove();
      term.remove();
    }
  });
  root.find("div, p, li, section, td, dd").each((_, node) => {
    const element = $(node);
    const children = element.children();
    if (children.length !== 2 || !children.first().is("span, label, strong, b") || !isHeading(children.first())) return;
    const outside = element.clone();
    outside.children().remove();
    if (!outside.text().trim()) element.remove();
  });
  root.find("h2, h3, h4, h5, h6, p, div").each((_, node) => {
    const marker = $(node);
    if (!node.parent || marker.closest(excluded).length || !isHeading(marker)) return;
    // Let an actual nested heading determine the section level.
    if (marker.find("h2, h3, h4, h5, h6, p, div").length) return;
    const tag = marker.prop("tagName")?.toLowerCase() ?? "";
    const level = /^h[2-6]$/.test(tag) ? Number(tag[1]) : 6;
    let branch = marker;
    // A heading-only wrapper still introduces its following sibling text.
    while (branch.parent().is("div") && isHeading(branch.parent())) branch = branch.parent();
    const boundary = Array.from({ length: level }, (_, i) => "h" + (i + 1)).join(", ");
    let sibling = branch.next();
    while (sibling.length && !sibling.is("main, article") && !sibling.is(boundary) && !sibling.find(boundary).length) {
      const next = sibling.next();
      sibling.remove();
      sibling = next;
    }
    // Remove intervening raw text nodes too, bounded by the same next section.
    const nodeAfter = sibling.get(0);
    let following = branch.get(0)?.nextSibling;
    while (following && following !== nodeAfter) {
      const next = following.nextSibling;
      $(following).remove();
      following = next;
    }
    branch.remove();
  });
}
