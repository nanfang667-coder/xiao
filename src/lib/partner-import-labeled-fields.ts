import { load, type CheerioAPI } from "cheerio";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { stripPartnerDeclarationText, removePartnerDeclarationSections } from "./partner-import-declarations.ts";

export type LabeledPartnerField =
  | "services" | "age" | "city" | "district" | "price" | "phone"
  | "wechat" | "qq" | "address" | "courseNotes" | "otherContact";

export type PartnerLabeledFieldsErrorCode = "DETAIL_AMBIGUOUS_FIELDS" | "DETAIL_LIMIT" | "INVALID_RESPONSE";

/** Fixed diagnostics only: source labels and values never enter error messages. */
export class PartnerLabeledFieldsError extends Error {
  readonly code: PartnerLabeledFieldsErrorCode;

  constructor(code: PartnerLabeledFieldsErrorCode) {
    super("合作方字段无法安全识别，请检查字段映射规则。");
    this.name = "PartnerLabeledFieldsError";
    this.code = code;
  }
}

const LABELS: Readonly<Record<string, LabeledPartnerField | null>> = {
  服务: "services", 服务内容: "services", 服务项目: "services",
  年龄: "age", 颜值: null, 声明信息: null,
  城市: "city", 省份: "city", 区域: "district", 区县: "district",
  价格: "price", 收费: "price", 费用: "price",
  电话: "phone", 手机: "phone", 手机号: "phone",
  微信: "wechat", 微信号: "wechat", QQ: "qq", QQ号: "qq",
  地址: "address", 详细地址: "address",
  备注: "courseNotes", 补充说明: "courseNotes", 其他联系方式: "otherContact",
};
const MAX_HTML_BYTES = 2_000_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 60;
const MAX_VALUE_LENGTH = 10_000;
const MAX_RECOGNIZED_LABELS = 200;
const FLOW_BLOCKS = "p, div, li, section, article, blockquote, pre, h2, h3, h4, h5, h6";
const INERT = 'script, style, noscript, template, iframe, object, embed, svg, canvas, [hidden], [aria-hidden="true"], nav, header, footer, aside, form, button, [data-import-ignore], [data-ad], .comments, .related, .post-meta, .author-info';
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;
const UNKNOWN_LABEL = /^[\p{L}][\p{L}\p{N} _-]{0,15}\s*[:：](?!\/\/)/u;
type Selection = ReturnType<CheerioAPI>;
type TreeNode = { children?: TreeNode[] };
type Label = { destination: LabeledPartnerField | null };

function fail(code: PartnerLabeledFieldsErrorCode): never {
  throw new PartnerLabeledFieldsError(code);
}

function plainText(element: Selection): string {
  const clone = element.clone();
  clone.find(INERT).remove();
  clone.find("br").replaceWith("\n");
  clone.find(FLOW_BLOCKS + ", tr, dt, dd").append("\n");
  return clone.text()
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function label(text: string): Label | null {
  const key = text.trim().replace(/[:：]$/, "").trim();
  if (!Object.hasOwn(LABELS, key)) return null;
  return { destination: LABELS[key] };
}

/** Reuse the exact structured-label vocabulary for introduction boundaries. */
export function partnerArticleFieldLabel(text: string): { destination: LabeledPartnerField | null } | null {
  return label(text);
}

/**
 * The caller supplies only its cleaned, uniquely bound article body. Exact
 * labels in two-column tables, definition lists, paired label/value elements,
 * or colon-separated lines are accepted. Values never cross a block boundary.
 * null preserves ordinary unstructured article handling; an empty fields map
 * with recognizedLabels > 0 deliberately prevents a whole-article fallback.
 */
export function extractLabeledArticleFields(
  cleanArticleHtml: string,
  ignoredFields: readonly LabeledPartnerField[] = [],
): { fields: Partial<Record<LabeledPartnerField, string>>; recognizedLabels: number } | null {
  if (typeof cleanArticleHtml !== "string") fail("INVALID_RESPONSE");
  if (Buffer.byteLength(cleanArticleHtml, "utf8") > MAX_HTML_BYTES) fail("DETAIL_LIMIT");
  const $ = load(cleanArticleHtml, undefined, false);
  let nodes = 0;
  function count(node: TreeNode, depth: number): void {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) fail("DETAIL_LIMIT");
    for (const child of node.children ?? []) count(child, depth + 1);
  }
  const root = $.root().get(0);
  if (root) count(root as TreeNode, 0);
  $(INERT).remove();
  $("[style]").filter((_, element) => HIDDEN_STYLE.test($(element).attr("style") ?? "")).remove();
  removePartnerDeclarationSections($, $.root());
  const fields: Partial<Record<LabeledPartnerField, string>> = {};
  const ignored = new Set(ignoredFields);
  let recognizedLabels = 0;
  function save(found: Label, value: string): void {
    if (++recognizedLabels > MAX_RECOGNIZED_LABELS) fail("DETAIL_LIMIT");
    const destination = found.destination;
    // Ignored fields and appearance labels remain boundaries, but their content
    // cannot interfere with an explicit caller mapping or survive in notes.
    if (destination === null || ignored.has(destination)) return;
    if (Object.hasOwn(fields, destination)) fail("DETAIL_AMBIGUOUS_FIELDS");
    value = stripPartnerDeclarationText(value);
    if (value.length > MAX_VALUE_LENGTH) fail("DETAIL_LIMIT");
    fields[destination] = value;
  }

  function lines(text: string): void {
    let active: Label | null = null;
    let value: string[] = [];
    const finish = () => {
      if (active) save(active, value.join("\n").trim());
      active = null;
      value = [];
    };
    for (const line of stripPartnerDeclarationText(text).split(/\n/)) {
      const match = /^([^:：\n]{1,16})\s*[:：]\s*(.*)$/.exec(line.trim());
      const found = match ? label(match[1]) : null;
      if (found) {
        finish();
        active = found;
        value = [match![2]];
      } else if (UNKNOWN_LABEL.test(line.trim())) finish();
      else if (active) value.push(line);
    }
    finish();
  }

  function paired(container: Selection): { found: Label | null; value: Selection } | null {
    if (!container.is("div, p, li, section, td, dd")) return null;
    const children = container.children();
    if (children.length !== 2 || !children.first().is("span, label, strong, b")) return null;
    const key = plainText(children.first());
    if (!/^[\p{L}][\p{L}\p{N} _-]{0,15}[:：]?$/u.test(key)) return null;
    const outsideText = container.clone();
    outsideText.children().remove();
    if (outsideText.text().trim()) return null;
    return { found: label(key), value: children.eq(1) };
  }

  function containsNestedFields(value: Selection): boolean {
    if (value.find("table, dl").length) return true;
    if (value.find(FLOW_BLOCKS).addBack().toArray().some((node) => paired($(node))?.found)) return true;
    return stripPartnerDeclarationText(plainText(value)).split(/\n/).some((line) => {
      const match = /^([^:：\n]{1,16})\s*[:：]/.exec(line.trim());
      return Boolean(match && label(match[1]));
    });
  }

  function consume(found: Label, value: Selection, valid: boolean): void {
    // An ignored/appearance field owns its complete value subtree. It must not
    // promote a nested table, pair or paragraph into another destination.
    if (found.destination !== null && !ignored.has(found.destination)
      && (!valid || containsNestedFields(value))) fail("DETAIL_AMBIGUOUS_FIELDS");
    save(found, valid ? plainText(value) : "");
  }

  const consumedDefinitions = new Set<unknown>();
  function visit(element: Selection): void {
    if (consumedDefinitions.has(element.get(0))) return;
    if (element.is("tr")) {
      const cells = element.children("th, td");
      const found = label(plainText(cells.first()));
      if (found) consume(found, cells.eq(1), cells.length === 2);
      // Unknown rows are also boundaries; never search their value for fields.
      return;
    }
    if (element.is("dt")) {
      const values = element.nextUntil("dt");
      for (const value of values.toArray()) consumedDefinitions.add(value);
      const found = label(plainText(element));
      if (found) consume(found, values, values.length === 1 && values.is("dd"));
      return;
    }
    const pair = paired(element);
    if (pair) {
      if (pair.found) consume(pair.found, pair.value, true);
      // Unknown dedicated label/value pairs cannot expose nested field data.
      return;
    }
    if (element.is(FLOW_BLOCKS) && !element.find(FLOW_BLOCKS + ", table, dl").length) {
      lines(plainText(element));
      return;
    }
    element.children().each((_, child) => visit($(child)));
  }
  $.root().children().each((_, element) => visit($(element)));
  // Direct root text supports a body made solely of text and <br>. Structured
  // containers are visited once above and never aggregated through ancestors.
  if (!$(FLOW_BLOCKS + ", table, dl").length) lines(plainText($.root()));
  return recognizedLabels ? { fields, recognizedLabels } : null;
}
