import { load, type CheerioAPI } from "cheerio";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { extractBoundNuxtImageUrls } from "./partner-import-nuxt-images.ts";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { extractLabeledArticleFields, partnerArticleFieldLabel } from "./partner-import-labeled-fields.ts";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { cleanPartnerImportFields, removePartnerDeclarationSections } from "./partner-import-declarations.ts";

export type PartnerImportField =
  | "name" | "type" | "city" | "district" | "price" | "services"
  | "courseNotes" | "age" | "phone" | "wechat" | "qq" | "otherContact" | "address";

export type PartnerImportRules = {
  postLinkSelector: string;
  fields?: Partial<Record<PartnerImportField, string>>;
  photoSelector?: string;
};

export type PartnerImportFields = {
  name: string;
  type: string;
  city: string;
  district: string;
  price: string;
  services: string;
  courseNotes: string | null;
  age: string | null;
  phone: string;
  wechat: string;
  qq: string | null;
  otherContact: string | null;
  address: string | null;
};

const LEGACY_POST_LINK_SELECTOR = 'a[href*="/listing/"]:has(h2), a[href*="/teacher/"]:has(h2)';

// Require a title/card structure. Unknown detail routes are allowed, but ordinary
// links and navigation must never become an implicit crawl of the whole site.
export const DEFAULT_PARTNER_IMPORT_RULES: PartnerImportRules = {
  postLinkSelector: `${LEGACY_POST_LINK_SELECTOR}, h1 a[href], h2 a[href], h3 a[href], h4 a[href]`,
};

export type PartnerParseErrorCode =
  | "INVALID_RULES" | "LISTING_NO_MATCH" | "LISTING_NO_SAFE_LINKS"
  | "TOO_MANY_POSTS" | "TOO_LARGE" | "INVALID_URL"
  | "DETAIL_MISSING_FIELDS" | "DETAIL_AMBIGUOUS_FIELDS" | "DETAIL_LIMIT";

const PARSE_ERROR_MESSAGES: Record<PartnerParseErrorCode, string> = {
  INVALID_RULES: "采集规则无效，请检查选择器语法、字段名称和配置格式。",
  LISTING_NO_MATCH: "未找到本页帖子链接，请检查列表选择器或确认页面无需登录、无需脚本加载。",
  LISTING_NO_SAFE_LINKS: "匹配到的链接均不是安全的帖子详情链接，请检查列表采集规则。",
  TOO_MANY_POSTS: "单页帖子超过 50 条，请缩小导入范围。",
  TOO_LARGE: "页面超过采集大小限制。",
  INVALID_URL: "页面或图片网址无效或格式不支持。",
  DETAIL_MISSING_FIELDS: "未找到帖子标题或正文，请检查字段选择器或确认页面无需登录、无需脚本加载。",
  DETAIL_AMBIGUOUS_FIELDS: "字段选择器匹配了多个区域，请缩小到单个字段容器。",
  DETAIL_LIMIT: "采集字段长度或单帖图片数量超过允许限制。",
};

export class PartnerParseError extends Error {
  readonly code: PartnerParseErrorCode;

  constructor(code: PartnerParseErrorCode) {
    super(PARSE_ERROR_MESSAGES[code]);
    this.name = "PartnerParseError";
    this.code = code;
  }
}

const FIELD_LIMITS: Record<PartnerImportField, number> = {
  name: 100, type: 50, city: 50, district: 50, price: 100,
  services: 4_000, courseNotes: 10_000, age: 50, phone: 100,
  wechat: 100, qq: 100, otherContact: 300, address: 500,
};
const MANUAL_IMPORT_FIELDS = new Set<PartnerImportField>(["price", "phone", "wechat", "qq", "otherContact", "address"]);
const MAX_POSTS = 50;
const MAX_PHOTOS = 8;
const MAX_HTML_LENGTH = 2_000_000;
const MAX_URL_LENGTH = 2_048;
const IGNORED_AREAS = 'nav, header, footer, aside, [role="navigation"], [data-import-ignore], [data-ad], [data-ad-slot], [aria-label="全国推广"], .advertisement, .pagination';
const INERT_CONTENT = 'script, style, noscript, template, iframe, object, embed, svg, canvas, [hidden], [aria-hidden="true"]';
const DEFAULT_PHOTO_SELECTOR = 'img[data-import-photo], [data-import-photos] img, div.grid.grid-cols-2 > button > img';

const DEFAULT_AVATAR_AREAS = [
  ".avatar, .gravatar, .author-avatar, .user-avatar, .profile-avatar",
  "#avatar, #gravatar, #author-avatar, #user-avatar, #profile-avatar",
  "[data-avatar], [data-author-avatar], [data-user-avatar], [data-profile-avatar]",
  ".author, .author-info, .author-box, .author-bio, .author-card, .author-details, .author-profile",
  ".post-author, .entry-author, .byline",
  "#author, #author-info, #author-box, #author-bio, #author-card, #author-details, #author-profile",
  '[itemprop~="author"], [rel~="author"], [data-author-info]',
].join(", ");

const DIRECTORY_SEGMENT = /^(?:categor(?:y|ies)|tags?|authors?|search|login|logout|register|signup|signin|admin[^/]*|wp[^/]*|feeds?|pages?)$/i;
const NAVIGATION_TITLE = /^(?:首页|主页|返回首页|上一页|下一页|前一页|后一页|末页|尾页|上一篇|下一篇|查看更多|查看全部|全部|更多|分类|栏目|导航|目录|搜索|登录|注册|标签|作者|最新帖子|帖子列表|home|next|previous|prev|more|categories?|tags?|search|log ?in|sign ?in|register)$/i;

const ARTICLE_NON_BODY = [
  IGNORED_AREAS, INERT_CONTENT,
  "h1, form, input, select, textarea, time",
  '[role="button"], [role="toolbar"], [role="dialog"], [role="banner"], [role="contentinfo"]',
  ".hidden, .d-none, .sr-only, .screen-reader-text",
  ".comments, .comments-area, .comment-list, .comment-respond, #comments, #respond",
  '[class^="comment-"], [class*=" comment-"], [id^="comment-"], [data-comments]',
  ".related, .related-posts, .related-articles, .recommendations, [data-related]",
  ".entry-meta, .post-meta, .article-meta, .byline, .posted-on, [data-post-meta]",
  ".entry-footer, .post-footer, .article-footer, .tags, .tag-links, .cat-links",
  ".share, .sharing, .social-share, .post-actions, .article-actions, .post-navigation",
  '[itemprop="author"], [itemprop="datePublished"], [itemprop="dateModified"], [itemprop="interactionStatistic"]',
  '[rel~="author"], [rel~="tag"]',
].join(", ");
const ARTICLE_NON_BODY_HEADING = /^(?:评论|最新评论|用户评论|发表评论|留言|留言评论|相关文章|相关推荐|推荐阅读|相关帖子|comments?|related posts|related articles)$/i;
const INLINE_HIDDEN = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

type Selection = ReturnType<CheerioAPI>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selector(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) {
    throw new PartnerParseError("INVALID_RULES");
  }
  const result = value.trim();
  try {
    load("<html><body><div></div></body></html>")(result);
  } catch {
    // Never echo source HTML, selectors, or parser exceptions into task logs.
    throw new PartnerParseError("INVALID_RULES");
  }
  return result;
}

export function normalizePartnerImportRules(value: unknown): PartnerImportRules {
  if (!record(value)) throw new PartnerParseError("INVALID_RULES");
  if (Object.keys(value).some((key) => !["postLinkSelector", "fields", "photoSelector"].includes(key))) {
    throw new PartnerParseError("INVALID_RULES");
  }
  const result: PartnerImportRules = {
    postLinkSelector: value.postLinkSelector == null || value.postLinkSelector === ""
      ? DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector
      : selector(value.postLinkSelector),
  };
  // Upgrade persisted former defaults in memory; custom mappings stay intact.
  if (result.postLinkSelector === LEGACY_POST_LINK_SELECTOR) {
    result.postLinkSelector = DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector;
  }
  if (value.fields !== undefined) {
    if (!record(value.fields)) throw new PartnerParseError("INVALID_RULES");
    result.fields = {};
    for (const [key, fieldSelector] of Object.entries(value.fields)) {
      if (!Object.hasOwn(FIELD_LIMITS, key)) throw new PartnerParseError("INVALID_RULES");
      result.fields[key as PartnerImportField] = selector(fieldSelector);
    }
  }
  if (value.photoSelector !== undefined) result.photoSelector = selector(value.photoSelector);
  return result;
}

function document(html: string): CheerioAPI {
  if (typeof html !== "string" || html.length > MAX_HTML_LENGTH) {
    throw new PartnerParseError("TOO_LARGE");
  }
  // Parsing is inert: no browser, script execution, RSC evaluation, or network fetches.
  const $ = load(html);
  $(INERT_CONTENT).remove();
  return $;
}

function httpUrl(value: string, base?: string): URL | null {
  if (!value.trim() || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

type HeadingGroup = { hrefs: Set<string>; headings: Set<unknown> };
type ListingCandidate = {
  href: string;
  heading: Selection;
  repeatedGroups: HeadingGroup[];
};

function isDetailPath(pathname: string): boolean {
  if (pathname === "/") return false;
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment).replace(/\.(?:html?|php|aspx?)$/i, ""));
  } catch {
    return false;
  }
  return !segments.some((segment) => DIRECTORY_SEGMENT.test(segment))
    && !/^(?:new|create|edit)$/i.test(segments.at(-1) ?? "");
}

function hasSubstantiveTitle(link: Selection): boolean {
  const wrappedTitle = link.find("h2").first();
  const text = plainText(wrappedTitle.length ? wrappedTitle : link).replace(/\s+/g, " ").trim();
  return text.length >= 2 && text.length <= 200
    && (text.match(/\p{L}/gu)?.length ?? 0) >= 2
    && !NAVIGATION_TITLE.test(text);
}

function groupRepeatedHeadings(candidates: ListingCandidate[]): void {
  // h1 often labels the entire site. Accept it only in repeated sibling
  // structures (same tags and relative depth), never as a lone heading.
  // Per-post classes often contain IDs or categories and are not structural.
  // A section is a grouping boundary: separate sections are not sibling cards.
  const parents = new Map<unknown, Map<string, HeadingGroup>>();
  for (const candidate of candidates) {
    if (!candidate.heading.is("h1")) continue;
    let branch = candidate.heading;
    let signature = "";
    for (let depth = 0; depth < 6 && branch.length; depth++) {
      const parent = branch.parent();
      if (!parent.length || parent.is("body, html") || branch.is("main, section")) break;
      signature = branch.prop("tagName") + ">" + signature;
      const parentNode = parent.get(0);
      let groups = parents.get(parentNode);
      if (!groups) {
        groups = new Map();
        parents.set(parentNode, groups);
      }
      let group = groups.get(signature);
      if (!group) {
        group = { hrefs: new Set(), headings: new Set() };
        groups.set(signature, group);
      }
      group.hrefs.add(candidate.href);
      group.headings.add(candidate.heading.get(0));
      candidate.repeatedGroups.push(group);
      branch = parent;
    }
  }
}

export function parsePartnerListing(html: string, pageUrl: string, input: PartnerImportRules): string[] {
  const rules = normalizePartnerImportRules(input);
  const page = httpUrl(pageUrl);
  if (!page) throw new PartnerParseError("INVALID_URL");
  const $ = document(html);
  const selected = $(rules.postLinkSelector);
  if (!selected.length) throw new PartnerParseError("LISTING_NO_MATCH");
  const usesDefault = rules.postLinkSelector === DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector;
  const candidates: ListingCandidate[] = [];
  selected.each((_, element) => {
    const link = $(element);
    if (!link.is("a[href]") || link.closest(IGNORED_AREAS).length) return;
    if (/\b(?:next|prev)\b/i.test(link.attr("rel") ?? "")) return;
    const href = link.attr("href")?.trim();
    if (!href || href.startsWith("#")) return;
    const url = httpUrl(href, page.href);
    if (!url || url.origin !== page.origin || url.href === page.href) return;
    // Same-path query links are pagination/filter controls, never detail links.
    if (url.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "")) return;
    if (!isDetailPath(url.pathname)) return;
    if (usesDefault && !hasSubstantiveTitle(link)) return;
    candidates.push({
      href: url.href,
      heading: usesDefault ? link.closest("h1, h2, h3, h4") : $(),
      repeatedGroups: [],
    });
  });
  if (usesDefault) groupRepeatedHeadings(candidates);
  const links = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.heading.is("h1") && !candidate.repeatedGroups.some((group) => group.hrefs.size > 1 && group.headings.size > 1)) continue;
    links.add(candidate.href);
    if (links.size > MAX_POSTS) throw new PartnerParseError("TOO_MANY_POSTS");
  }
  if (!links.size) throw new PartnerParseError("LISTING_NO_SAFE_LINKS");
  return [...links];
}

function plainText(element: Selection): string {
  const clean = element.clone();
  clean.find(INERT_CONTENT).remove();
  clean.find("br").replaceWith("\n");
  clean.find("p, div, li, section, article, h1, h2, h3, h4, h5, h6, tr").append("\n");
  return clean.text()
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function singleText(elements: Selection): string {
  if (elements.length > 1) throw new PartnerParseError("DETAIL_AMBIGUOUS_FIELDS");
  if (elements.is("meta[content]")) return elements.attr("content")?.trim() ?? "";
  return plainText(elements);
}


function manualFieldElementsRemoved($: CheerioAPI, elements: Selection): Selection {
  const copy = elements.clone();
  const isManualLabel = (text: string) => {
    const found = partnerArticleFieldLabel(text);
    return found?.destination != null && MANUAL_IMPORT_FIELDS.has(found.destination);
  };
  copy.find("tr, dt, div, p, li, section, td, dd, [data-import-field]").addBack().each((_, node) => {
    const element = $(node);
    const marker = element.attr("data-import-field") as PartnerImportField | undefined;
    if (marker && MANUAL_IMPORT_FIELDS.has(marker)) {
      element.empty();
      return;
    }
    if (element.is("tr") && isManualLabel(plainText(element.children("th, td").first()))) {
      element.empty();
      return;
    }
    if (element.is("dt") && isManualLabel(plainText(element))) {
      element.nextUntil("dt").empty();
      element.empty();
      return;
    }
    if (element.is("section") && plainText(element.children("h2").first()) === "联系方式") {
      element.empty();
      return;
    }
    const children = element.children();
    if (children.length === 2 && children.first().is("span, label, strong, b") &&
        isManualLabel(plainText(children.first()))) children.remove();
  });
  return copy;
}

function importFieldText($: CheerioAPI, elements: Selection, key: PartnerImportField): string {
  return singleText(key === "services" || key === "courseNotes" ? manualFieldElementsRemoved($, elements) : elements);
}

function namedSection($: CheerioAPI, title: string): Selection {
  return $("section").filter((_, element) => {
    return !$(element).closest(IGNORED_AREAS).length && plainText($(element).children("h2").first()) === title;
  });
}

function sectionBody($: CheerioAPI, title: string): string {
  const section = namedSection($, title).clone();
  section.children("h2").remove();
  return singleText(title === "服务内容" || title === "补充说明" ? manualFieldElementsRemoved($, section) : section);
}

function contactValue($: CheerioAPI, title: string): string {
  const labels = namedSection($, "联系方式").find("span").filter((_, element) => plainText($(element)) === title);
  return singleText(labels.next());
}


function isDefaultPhotoCandidate(element: Selection): boolean {
  // Explicit author/avatar markup is structural evidence; image alt text,
  // dimensions and incidental URL words are not reliable exclusion rules.
  return element.closest(DEFAULT_AVATAR_AREAS).length === 0;
}

function defaultTitle($: CheerioAPI): Selection {
  return $("h1").filter((_, element) => !$(element).closest(IGNORED_AREAS).length);
}

function semanticArticle($: CheerioAPI, strict = true): Selection | null {
  const articles = $("article").filter((_, element) => {
    const article = $(element);
    return !article.closest(ARTICLE_NON_BODY + ", button").length
      && !article.parents().addBack().filter((_, parent) => INLINE_HIDDEN.test($(parent).attr("style") ?? "")).length;
  });
  if (articles.length > 1 && strict) throw new PartnerParseError("DETAIL_AMBIGUOUS_FIELDS");
  if (articles.length !== 1) return null;
  const title = defaultTitle($);
  const articleTitles = articles.find("h1").filter((_, element) => !$(element).closest(IGNORED_AREAS).length);
  if (title.length !== 1 || articleTitles.length !== 1 || title.get(0) !== articleTitles.get(0)) return null;
  // A password/challenge form can leave explanatory text after form removal.
  // Such shells require an explicit mapping instead of a whole-article guess.
  if (articles.find('input[type="password"], [data-sitekey], #challenge-form').length) return null;
  return articles;
}

function semanticArticleBody($: CheerioAPI, strict = true): Selection | null {
  const articles = semanticArticle($, strict);
  if (!articles) return null;
  const body = articles.clone();
  // Clean exclusions before unwrapping buttons, so their own advertising,
  // metadata or hidden attributes cannot disappear while leaving images behind.
  body.find(ARTICLE_NON_BODY).remove();
  body.find("[style]").filter((_, element) => INLINE_HIDDEN.test($(element).attr("style") ?? "")).remove();
  body.find("section, div").filter((_, element) => {
    const heading = $(element).children("h2, h3, h4").first();
    return heading.length > 0 && ARTICLE_NON_BODY_HEADING.test(plainText(heading));
  }).remove();
  // Preserve only images already supported by the established gallery rules.
  // Gallery buttons are controls; their labels and other descendants stay out.
  const supportedGalleryImages = new Set(body.find(DEFAULT_PHOTO_SELECTOR)
    .filter((_, element) => isDefaultPhotoCandidate($(element))).toArray());
  body.find("button").each((_, element) => {
    const button = $(element);
    const images = button.find("img").filter((_, image) => supportedGalleryImages.has(image));
    if (images.length) button.replaceWith(images.clone().attr("data-import-photo", ""));
  });
  body.find("button").remove();
  const text = plainText(body);
  return (text.match(/\p{L}/gu)?.length ?? 0) >= 2 ? body : null;
}


function recognizedLineLabel(line: string) {
  const match = /^([^:：\n]{1,16})\s*[:：]\s*/.exec(line.trim());
  return match ? partnerArticleFieldLabel(match[1]) : null;
}

// Source contact, price and address fields are manually entered values. Preserve their
// boundaries even inside a broad explicit service/notes mapping.
function withoutManualFieldText(text: string): string {
  const kept: string[] = [];
  let discard = false;
  for (const line of text.split("\n")) {
    const found = recognizedLineLabel(line);
    if (found) discard = found.destination !== null && MANUAL_IMPORT_FIELDS.has(found.destination);
    if (!discard) kept.push(line);
  }
  return kept.join("\n").trim();
}

function articleIntroduction($: CheerioAPI, rules: PartnerImportRules): string {
  const article = semanticArticle($, false);
  if (!article) return "";
  const copy = article.clone();
  const serviceSelector = rules.fields?.services ?? '[data-import-field="services"]';
  const serviceAreas = copy.find(serviceSelector).add(copy.filter(serviceSelector));
  if (serviceAreas.find("h1").length) return "";
  const serviceBoundaries = new Set<unknown>(serviceAreas.toArray());
  copy.find(ARTICLE_NON_BODY + ", " + DEFAULT_AVATAR_AREAS + ", button, figure, picture, video, audio, .metadata, .post-info")
    .filter((_, element) => !$(element).is("h1")).remove();
  copy.find("[style]").filter((_, element) => INLINE_HIDDEN.test($(element).attr("style") ?? "")).remove();
  let afterTitle = false;
  let stopped = false;
  const text: string[] = [];
  function visit(element: Selection): void {
    if (stopped) return;
    const node = element.get(0);
    if (!node) return;
    if (element.is("h1")) {
      afterTitle = true;
      return;
    }
    if (afterTitle) {
      if (serviceBoundaries.has(node) || element.is("table, dl, h2, h3, h4, h5, h6, [data-import-field], a[href^='tel:'], a[href^='mailto:']")) {
        stopped = true;
        return;
      }
      const siblings = element.parent().children();
      if (element.is("span, label, strong, b") && siblings.length === 2 && siblings.first().get(0) === node &&
          partnerArticleFieldLabel(plainText(element))) {
        stopped = true;
        return;
      }
      if (node.type === "text") {
        text.push(element.text());
        return;
      }
    }
    if (element.is("br")) text.push("\n");
    const block = element.is("p, div, li, section, article, blockquote, pre");
    if (block && afterTitle) text.push("\n");
    element.contents().each((_, child) => visit($(child)));
    if (block && afterTitle && !stopped) text.push("\n");
  }
  visit(copy);
  const introduction: string[] = [];
  let textBoundary = false;
  for (const line of text.join("").replace(/[\t\r ]+/g, " ").split("\n")) {
    const trimmed = line.trim();
    if (recognizedLineLabel(trimmed) || partnerArticleFieldLabel(trimmed)) {
      textBoundary = true;
      break;
    }
    if (/^(?:发布于|发布时间|发布日期|更新时间|作者|浏览次数|阅读次数)\s*[:：]?/.test(trimmed)) continue;
    introduction.push(trimmed);
  }
  return stopped || textBoundary ? introduction.join("\n").replace(/\n{3,}/g, "\n\n").trim() : "";
}

function mergeIntroductionAndNotes(introduction: string, notes: string): string {
  const paragraphs: string[] = [];
  const seen = new Set<string>();
  for (const text of [introduction, notes]) {
    for (const paragraph of text.split(/\n+/).map((value) => value.trim()).filter(Boolean)) {
      if (seen.has(paragraph)) continue;
      seen.add(paragraph);
      paragraphs.push(paragraph);
    }
  }
  return paragraphs.join("\n\n");
}

function defaultField($: CheerioAPI, key: PartnerImportField): string {
  if (key === "type") return "";
  if (key === "services") return sectionBody($, "服务内容");
  if (key === "courseNotes") return sectionBody($, "补充说明");
  if (key === "address") return sectionBody($, "详细地址");
  if (key === "phone") return contactValue($, "电话");
  if (key === "wechat") return contactValue($, "微信");
  if (key === "qq") return contactValue($, "QQ");
  if (key === "otherContact") return contactValue($, "其他");
  const title = defaultTitle($);
  if (key === "name") {
    const titleOnly = title.clone();
    titleOnly.find("span").filter((_, element) => /^年龄/.test(plainText($(element)))).remove();
    return singleText(titleOnly);
  }
  if (key === "age") {
    const age = title.find("span").filter((_, element) => /^年龄/.test(plainText($(element))));
    return singleText(age).replace(/^年龄\s*/, "");
  }
  const titleBlock = title.parent();
  if (key === "price") return singleText(titleBlock.children("div.text-rose-500"));
  const location = titleBlock.children("div").filter((_, element) => /^📍/.test(plainText($(element))));
  const parts = singleText(location).replace(/^📍\s*/, "").split(/\s*[·｜|]\s*/);
  return key === "city" ? parts[0] ?? "" : parts.slice(1).join(" · ");
}

export function parsePartnerDetail(html: string, detailUrl: string, input: PartnerImportRules): {
  fields: PartnerImportFields;
  photoUrls: string[];
} {
  const rules = normalizePartnerImportRules(input);
  const detail = httpUrl(detailUrl);
  if (!detail) throw new PartnerParseError("INVALID_URL");
  const $ = document(html);
  const $text = load($.html());
  removePartnerDeclarationSections($text, $text.root());
  let values = {} as Record<PartnerImportField, string>;
  const protectedFields = new Set<PartnerImportField>(["name", "type", ...MANUAL_IMPORT_FIELDS]);
  let articleBody: Selection | null = null;
  for (const key of Object.keys(FIELD_LIMITS) as PartnerImportField[]) {
    if (MANUAL_IMPORT_FIELDS.has(key)) {
      values[key] = "";
      continue;
    }
    const fieldDocument = key === "name" || key === "type" ? $ : $text;
    const explicit = rules.fields?.[key];
    const marked = fieldDocument(`[data-import-field="${key}"]`);
    let value: string;
    if (explicit) {
      value = importFieldText(fieldDocument, fieldDocument(explicit), key);
      protectedFields.add(key);
    } else if (marked.length) {
      value = importFieldText(fieldDocument, marked, key);
      protectedFields.add(key);
    } else if (key === "services" && !namedSection($text, "服务内容").length) {
      // Keep the article for photos, but split its labeled fields before using
      // any of its text as services. An explicit empty mapping never falls back.
      articleBody = semanticArticleBody($);
      value = "";
    } else {
      value = defaultField(fieldDocument, key);
      if (value || key === "services"
        || key === "address" && namedSection($text, "详细地址").length
        || key === "courseNotes" && namedSection($text, "补充说明").length) protectedFields.add(key);
    }
    values[key] = value;
  }

  // Field fallback is independent per field. Optional discovery must not make
  // an otherwise valid explicit mapping depend on a unique article layout.
  const fieldBody = semanticArticleBody($text, false);
  if (fieldBody) {
    const ignored = [...protectedFields].filter((field): field is Exclude<PartnerImportField, "name" | "type"> => field !== "name" && field !== "type");
    const labeled = extractLabeledArticleFields(fieldBody.toString(), ignored);
    if (!protectedFields.has("courseNotes") && (labeled || protectedFields.has("services"))) {
      values.courseNotes = mergeIntroductionAndNotes(articleIntroduction($text, rules), labeled?.fields.courseNotes ?? "");
    }
    if (labeled) {
      // A recognized structured article must supply its own service field.
      // Never put age, appearance, contact details or unrelated text in services.
      for (const [key, value] of Object.entries(labeled.fields)) {
        const field = key as PartnerImportField;
        if (field !== "courseNotes" && !protectedFields.has(field)) values[field] = value as string;
      }
    } else if (articleBody) {
      values.services = singleText(fieldBody);
    }
  }
  values.services = withoutManualFieldText(values.services);
  values.courseNotes = withoutManualFieldText(values.courseNotes);
  values = cleanPartnerImportFields(values);
  for (const key of Object.keys(FIELD_LIMITS) as PartnerImportField[]) {
    if (values[key].length > FIELD_LIMITS[key]) throw new PartnerParseError("DETAIL_LIMIT");
  }
  if (!values.name || !values.services) {
    throw new PartnerParseError("DETAIL_MISSING_FIELDS");
  }

  const photos = new Set<string>();
  const defaultPhotos = (articleBody ? articleBody.find(DEFAULT_PHOTO_SELECTOR) : $(DEFAULT_PHOTO_SELECTOR))
    .filter((_, element) => !$(element).closest(IGNORED_AREAS).length && isDefaultPhotoCandidate($(element)));
  const hasPhotoMarkers = (articleBody ? articleBody.find('[data-import-photos], img[data-import-photo]')
    : $('[data-import-photos], img[data-import-photo]'))
    .filter((_, element) => isDefaultPhotoCandidate($(element))).length > 0;
  // Bind static image data to the unique visible article. Explicit selectors
  // and photo markers remain authoritative; scripts are never executed.
  let boundPhotos: string[] | null = null;
  if (!rules.photoSelector && !hasPhotoMarkers && html.includes("__NUXT_DATA__")) {
    const article = semanticArticle($);
    if (article) boundPhotos = extractBoundNuxtImageUrls({
      html, detailUrl: detail.href, articleTitle: plainText(article.find("h1")),
    });
  }
  if (boundPhotos !== null) for (const url of boundPhotos) photos.add(url);
  const photoElements = boundPhotos !== null ? $() : rules.photoSelector ? $(rules.photoSelector)
    : defaultPhotos.length || hasPhotoMarkers || !articleBody ? defaultPhotos : articleBody.find("img");
  photoElements.each((_, element) => {
    const image = $(element);
    if (image.closest(IGNORED_AREAS).length) return;
    // A deliberate custom photoSelector may override avatar classification.
    if (!rules.photoSelector && !isDefaultPhotoCandidate(image)) return;
    if (!image.is("img")) throw new PartnerParseError("INVALID_RULES");
    const src = image.attr("data-src")?.trim() || image.attr("src")?.trim();
    const url = src ? httpUrl(src, detail.href) : null;
    if (!url) throw new PartnerParseError("INVALID_URL");
    photos.add(url.href);
    if (photos.size > MAX_PHOTOS) throw new PartnerParseError("DETAIL_LIMIT");
  });
  return {
    fields: {
      ...values,
      courseNotes: values.courseNotes || null,
      age: values.age || null,
      qq: values.qq || null,
      otherContact: values.otherContact || null,
      address: values.address || null,
    },
    photoUrls: [...photos],
  };
}


