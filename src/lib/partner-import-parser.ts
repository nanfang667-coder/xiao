import { load, type CheerioAPI } from "cheerio";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { extractBoundNuxtImageUrls } from "./partner-import-nuxt-images.ts";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { normalizePartnerPageUrlTemplate } from "./partner-image-pagination.ts";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { DISCUZ_FIRST_POST_PHOTO_SELECTOR } from "./partner-discuz-image-rules.ts";

export type PartnerImportField =
  | "name" | "type" | "city" | "district" | "price" | "services"
  | "courseNotes" | "age" | "phone" | "wechat" | "qq" | "otherContact" | "address";

export type PartnerImportRules = {
  postLinkSelector: string;
  fields?: Partial<Record<PartnerImportField, string>>;
  photoSelector?: string;
  nextPageSelector?: string;
  pageUrlTemplate?: string;
};

const LEGACY_POST_LINK_SELECTOR = 'a[href*="/listing/"]:has(h2), a[href*="/teacher/"]:has(h2)';
const PREVIOUS_DEFAULT_POST_LINK_SELECTOR = `${LEGACY_POST_LINK_SELECTOR}, h1 a[href], h2 a[href], h3 a[href], h4 a[href]`;

// Require a title/card structure. Unknown detail routes are allowed, but ordinary
// links and navigation must never become an implicit crawl of the whole site.
export const DEFAULT_PARTNER_IMPORT_RULES: PartnerImportRules = {
  postLinkSelector: 'a[href]:has(h2), a[href]:has(h3), a[href]:has(h4), h1 a[href], h2 a[href], h3 a[href], h4 a[href]',
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
// Accept persisted field mappings for source configuration compatibility only.
const COMPATIBLE_FIELDS = new Set<PartnerImportField>([
  "name", "type", "city", "district", "price", "services", "courseNotes", "age",
  "phone", "wechat", "qq", "otherContact", "address",
]);

const MAX_POSTS = 50;
const MAX_PHOTOS = 8;
const MAX_HTML_LENGTH = 2_000_000;
const MAX_URL_LENGTH = 2_048;
const IGNORED_AREAS = 'nav, header, footer, aside, [role="navigation"], [data-import-ignore], [data-ad], [data-ad-slot], [aria-label="全国推广"], .advertisement, .advert, .ads, .ad, .pagination';
const INERT_ELEMENTS = "script, style, noscript, template, iframe, object, embed, svg, canvas";
const INERT_CONTENT = `${INERT_ELEMENTS}, [hidden], [aria-hidden="true"]`;
const DEFAULT_PHOTO_SELECTOR = 'img[data-import-photo], [data-import-photos] img, div.grid.grid-cols-2 > button > img';
const DISCUZ_POST_SELECTOR = '#threadlist a.xst[href], #threadlisttableid a.xst[href], tbody[id^="normalthread_"] th a.xst[href]';
const DISCUZ_CARD_SELECTOR = 'a[href]:has(img)';
const DISCUZ_NON_PHOTO_AREAS = '.pls, .pi, .pob, .sign, .signature, .signatures, .quote, blockquote, .pstatus, .attachtype, .locked, .locked_tip, .smilie, .smilies, [smilieid]';
const DISCUZ_CARD_EXCLUDED_AREAS = `${IGNORED_AREAS}, ${DISCUZ_NON_PHOTO_AREAS}, .pg, .pgs, button, [role="button"], .avt`;

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
  if (Object.keys(value).some((key) => !["postLinkSelector", "fields", "photoSelector", "nextPageSelector", "pageUrlTemplate"].includes(key))) {
    throw new PartnerParseError("INVALID_RULES");
  }
  const result: PartnerImportRules = {
    postLinkSelector: value.postLinkSelector == null || value.postLinkSelector === ""
      ? DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector
      : selector(value.postLinkSelector),
  };
  // Upgrade persisted former defaults in memory; custom mappings stay intact.
  if (result.postLinkSelector === LEGACY_POST_LINK_SELECTOR || result.postLinkSelector === PREVIOUS_DEFAULT_POST_LINK_SELECTOR) {
    result.postLinkSelector = DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector;
  }
  if (value.fields !== undefined) {
    if (!record(value.fields)) throw new PartnerParseError("INVALID_RULES");
    result.fields = {};
    for (const [key, fieldSelector] of Object.entries(value.fields)) {
      if (!COMPATIBLE_FIELDS.has(key as PartnerImportField)) throw new PartnerParseError("INVALID_RULES");
      result.fields[key as PartnerImportField] = selector(fieldSelector);
    }
  }
  if (value.photoSelector !== undefined) result.photoSelector = selector(value.photoSelector);
  if (value.nextPageSelector !== undefined) result.nextPageSelector = selector(value.nextPageSelector);
  if (value.pageUrlTemplate !== undefined) {
    try { result.pageUrlTemplate = normalizePartnerPageUrlTemplate(value.pageUrlTemplate); }
    catch { throw new PartnerParseError("INVALID_RULES"); }
  }
  return result;
}

function document(html: string, preserveHidden = false): CheerioAPI {
  if (typeof html !== "string" || html.length > MAX_HTML_LENGTH) {
    throw new PartnerParseError("TOO_LARGE");
  }
  // Parsing is inert: no browser, script execution, RSC evaluation, or network fetches.
  const $ = load(html);
  $(preserveHidden ? INERT_ELEMENTS : INERT_CONTENT).remove();
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

function positiveDecimal(value: string | null): boolean {
  return value !== null && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function isDiscuzListing(url: URL): boolean {
  const seo = /\/forum-([1-9]\d*)-([1-9]\d*)\.html$/.exec(url.pathname);
  if (seo && positiveDecimal(seo[1]) && positiveDecimal(seo[2])) return true;
  return /\/forum\.php$/.test(url.pathname)
    && url.searchParams.getAll("mod").length === 1
    && url.searchParams.get("mod") === "forumdisplay"
    && url.searchParams.getAll("fid").length === 1
    && positiveDecimal(url.searchParams.get("fid"));
}

/** Only explicit thread identities qualify for a same-path query exception. */
function discuzThread(url: URL): { canonical: string; page: number } | null {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const canonical = new URL(url.href);
  canonical.hash = "";
  const seo = /\/thread-([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)\.html$/.exec(url.pathname);
  if (seo) {
    if (!positiveDecimal(seo[1]) || !positiveDecimal(seo[2])
      || !Number.isSafeInteger(Number(seo[3])) || keys.some(key => !["extra", "highlight"].includes(key))) return null;
    canonical.pathname = canonical.pathname.replace(/thread-[^/]+$/, `thread-${seo[1]}-1-1.html`);
    canonical.search = "";
    return { canonical: canonical.href, page: Number(seo[2]) };
  }
  if (!/\/forum\.php$/.test(url.pathname)
    || keys.some(key => !["mod", "tid", "page", "extra", "highlight"].includes(key))
    || url.searchParams.get("mod") !== "viewthread"
    || !positiveDecimal(url.searchParams.get("tid"))
    || url.searchParams.has("page") && !positiveDecimal(url.searchParams.get("page"))) return null;
  canonical.search = "";
  canonical.searchParams.set("mod", "viewthread");
  canonical.searchParams.set("tid", url.searchParams.get("tid")!);
  return { canonical: canonical.href, page: Number(url.searchParams.get("page") ?? "1") };
}

function visiblyAvailable($: CheerioAPI, element: Selection): boolean {
  return element.parents().addBack().filter((_, node) => {
    const current = $(node);
    return current.is('[hidden], [aria-hidden="true"], .hidden, .d-none, .sr-only, .screen-reader-text')
      || INLINE_HIDDEN.test(current.attr("style") ?? "");
  }).length === 0;
}

function hasDiscuzCardImage($: CheerioAPI, link: Selection, page: URL): boolean {
  if (link.closest(DISCUZ_CARD_EXCLUDED_AREAS).length
    || NAVIGATION_TITLE.test(plainText(link).replace(/\s+/g, " ").trim())) return false;
  const forms = link.parents("form");
  // Discuz wraps its selectable thread list in this moderation form. It is a
  // list container, not evidence that every descendant is an action control.
  if (forms.length && (forms.length !== 1 || !forms.is("form#moderate")
    || $("form#moderate").length !== 1
    || forms.find('input[type="password"], [data-sitekey], #challenge-form').length)) return false;
  return link.find("img").toArray().some(node => {
    const image = $(node);
    const imageForms = image.parents("form");
    if (!visiblyAvailable($, image) || !isDefaultPhotoCandidate(image)
      || image.closest(DISCUZ_CARD_EXCLUDED_AREAS).length
      || imageForms.length !== forms.length || imageForms.get(0) !== forms.get(0)) return false;
    const source = imageSource(image, true);
    const url = source ? httpUrl(source, page.href) : null;
    return url !== null && !/(?:^|\/)static\/image\//i.test(url.pathname)
      && !/\/(?:none|image_s)\.gif$/i.test(url.pathname);
  });
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

function substantiveTitleText(element: Selection): string | null {
  const text = plainText(element).replace(/\s+/g, " ").trim();
  return text.length >= 2 && text.length <= 200
    && (text.match(/\p{L}/gu)?.length ?? 0) >= 2
    && !NAVIGATION_TITLE.test(text) ? text : null;
}

function hasSubstantiveTitle($: CheerioAPI, link: Selection): boolean {
  const wrappedTitles = link.find("h2, h3, h4");
  if (!wrappedTitles.length) return substantiveTitleText(link) !== null;
  const titles = new Set<string>();
  wrappedTitles.each((_, element) => {
    if ($(element).closest(IGNORED_AREAS).length) return;
    const title = substantiveTitleText($(element));
    if (title !== null) titles.add(title);
  });
  // Responsive copies of one title are one card; multiple distinct titles are
  // a section/container, not evidence that the surrounding link is one post.
  return titles.size === 1;
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
  const usesDefault = rules.postLinkSelector === DEFAULT_PARTNER_IMPORT_RULES.postLinkSelector;
  const forumListing = isDiscuzListing(page);
  const selected = $(rules.postLinkSelector).add(
    usesDefault && forumListing ? $(`${DISCUZ_POST_SELECTOR}, ${DISCUZ_CARD_SELECTOR}`) : $(),
  );
  if (!selected.length) throw new PartnerParseError("LISTING_NO_MATCH");
  const candidates: ListingCandidate[] = [];
  selected.each((_, element) => {
    const link = $(element);
    if (!link.is("a[href]") || link.closest(IGNORED_AREAS).length) return;
    if (/\b(?:next|prev)\b/i.test(link.attr("rel") ?? "")) return;
    const href = link.attr("href")?.trim();
    if (!href || href.startsWith("#")) return;
    const url = httpUrl(href, page.href);
    if (!url || url.origin !== page.origin || url.href === page.href) return;
    const thread = forumListing ? discuzThread(url) : null;
    if (forumListing) {
      if (!visiblyAvailable($, link)) return;
      if (/\/(?:forum|member|home|search|misc|plugin|admincp)\.php$/.test(url.pathname) && !thread) return;
      if (usesDefault && !thread) return;
    }
    // Query-only pagination stays excluded; a proven Discuz thread is the only exception.
    if (url.pathname.replace(/\/$/, "") === page.pathname.replace(/\/$/, "") && !thread) return;
    if (!isDetailPath(url.pathname)) return;
    const titleCandidate = !forumListing || link.is(rules.postLinkSelector) || link.is(DISCUZ_POST_SELECTOR);
    if (usesDefault && !(titleCandidate && hasSubstantiveTitle($, link))
      && !(thread && hasDiscuzCardImage($, link, page))) return;
    candidates.push({
      href: thread?.canonical ?? url.href,
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


function isDefaultPhotoCandidate(element: Selection): boolean {
  // Explicit author/avatar markup is structural evidence; image alt text,
  // dimensions and incidental URL words are not reliable exclusion rules.
  return element.closest(DEFAULT_AVATAR_AREAS).length === 0;
}

function defaultTitle($: CheerioAPI): Selection {
  return $("h1").filter((_, element) => !$(element).closest(IGNORED_AREAS).length);
}

function visibleArticles($: CheerioAPI): Selection {
  return $("article").filter((_, element) => {
    const article = $(element);
    return !article.closest(ARTICLE_NON_BODY + ", button").length
      && !article.parents().addBack().filter((_, parent) => INLINE_HIDDEN.test($(parent).attr("style") ?? "")).length;
  });
}

function semanticArticle($: CheerioAPI, strict = true): Selection | null {
  const articles = visibleArticles($);
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

function cleanArticleBody($: CheerioAPI, articles: Selection): Selection {
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
  return body;
}

/** Select an explicitly marked first floor, never the first visible reply. */
function discuzFirstPostBody($: CheerioAPI): Selection | null {
  const lists = $("#postlist");
  if (lists.length !== 1) return null;
  const posts = lists.children('div[id^="post_"]').filter((_, element) => /^post_[1-9]\d*$/.test($(element).attr("id") ?? ""));
  const first = posts.first();
  if (!first.length || !visiblyAvailable($, first)) return null;
  const id = first.attr("id")!.slice("post_".length);
  if (posts.filter((_, element) => $(element).attr("id") === first.attr("id")).length !== 1) return null;
  const floor = first.find(`[id="postnum${id}"]`);
  let markedFirst = first.is('.first, [first="1"], [data-first-post="true"]')
    || first.find(`[id="pid${id}"][first="1"], [id="postmessage_${id}"][first="1"]`).length > 0;
  if (floor.length) {
    if (floor.length !== 1 || !visiblyAvailable($, floor)) return null;
    const label = plainText(floor).replace(/\s+/g, "");
    // Custom themes often replace the number with the explicit author-floor label.
    if (!/^(?:1#?|楼主#?)$/.test(label)) return null;
    markedFirst = true;
  }
  if (!markedFirst) return null;
  const body = first.find(`[id="postmessage_${id}"]`);
  if (body.length !== 1 || !visiblyAvailable($, body)
    || body.closest('div[id^="post_"]').get(0) !== first.get(0)
    || body.closest(IGNORED_AREAS + ", " + DISCUZ_NON_PHOTO_AREAS).length
    || body.find('input[type="password"], [data-sitekey], #challenge-form').length) return null;
  return body;
}

function applyDiscuzPhotoPreset($: CheerioAPI): boolean {
  const lists = $("div#postlist");
  if (lists.length !== 1 || $("#postlist").length !== 1
    || lists.is("[data-sitekey]")
    || lists.find('input[type="password"], [data-sitekey], #challenge-form').length) return false;
  // Only an explicitly saved source preset opts into this theme convention.
  // Semantic hiding, visibility:hidden and every other hidden node still apply.
  const style = lists.attr("style");
  if (style) lists.attr("style", style.replace(/(^|;)\s*display\s*:\s*none\s*(?:!important)?\s*(?=;|$)/gi, "$1"));
  return true;
}

function imageSource(image: Selection, discuz = false): string | undefined {
  const attributes = discuz ? ["zoomfile", "file", "data-src", "src"] : ["data-src", "src"];
  for (const attribute of attributes) {
    const value = image.attr(attribute)?.trim();
    if (value) return value;
  }
  return undefined;
}

function discuzPostPhotos($: CheerioAPI, body: Selection, detail: URL): string[] {
  const photos = new Set<string>();
  const post = body.closest('div[id^="post_"]');
  const region = body.closest(".t_fsz");
  let images = body.find("img");
  // Some themes render attachments next to the message, inside its own content
  // region. Bind that region to this verified first post, never the whole page.
  if (region.length === 1 && region.closest('div[id^="post_"]').get(0) === post.get(0)
    && region.find('[id^="postmessage_"]').length === 1) {
    images = images.add(region.find(".pattl img").filter((_, element) =>
      $(element).closest(".t_fsz").get(0) === region.get(0)));
  }
  images.each((_, element) => {
    const image = $(element);
    if (!visiblyAvailable($, image) || !isDefaultPhotoCandidate(image)
      || image.closest(ARTICLE_NON_BODY + ", " + DISCUZ_NON_PHOTO_AREAS).length
      || image.closest('div[id^="post_"]').get(0) !== post.get(0)) return;
    const source = imageSource(image, true);
    const url = source ? httpUrl(source, detail.href) : null;
    if (!url) throw new PartnerParseError("INVALID_URL");
    // Discuz controls use this static tree and these placeholders, never attachments.
    if (/(?:^|\/)static\/image\//i.test(url.pathname) || /\/(?:none|image_s)\.gif$/i.test(url.pathname)) return;
    photos.add(url.href);
    if (photos.size > MAX_PHOTOS) throw new PartnerParseError("DETAIL_LIMIT");
  });
  return [...photos];
}

function detailPhotoUrls($: CheerioAPI, html: string, detail: URL, rules: PartnerImportRules, articleBody: Selection | null): string[] {
  const photos = new Set<string>();
  const defaultPhotos = (articleBody ? articleBody.find(DEFAULT_PHOTO_SELECTOR) : $(DEFAULT_PHOTO_SELECTOR))
    .filter((_, element) => !$(element).closest(IGNORED_AREAS).length && isDefaultPhotoCandidate($(element)));
  const hasPhotoMarkers = (articleBody ? articleBody.find('[data-import-photos], img[data-import-photo]')
    : $('[data-import-photos], img[data-import-photo]'))
    .filter((_, element) => isDefaultPhotoCandidate($(element))).length > 0;
  // Bind static image data to the unique visible article. Scripts remain inert.
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
    const src = imageSource(image, Boolean(discuzThread(detail)));
    const url = src ? httpUrl(src, detail.href) : null;
    if (!url) throw new PartnerParseError("INVALID_URL");
    photos.add(url.href);
    if (photos.size > MAX_PHOTOS) throw new PartnerParseError("DETAIL_LIMIT");
  });
  return [...photos];
}

/** Image collection does not depend on importing a title, body or contact fields. */
export function parsePartnerImageUrls(html: string, detailUrl: string, input: PartnerImportRules): string[] {
  const rules = normalizePartnerImportRules({ postLinkSelector: input.postLinkSelector, photoSelector: input.photoSelector });
  const detail = httpUrl(detailUrl);
  if (!detail) throw new PartnerParseError("INVALID_URL");
  const forumThread = /\/forum\.php$/.test(detail.pathname) && detail.searchParams.getAll("mod").includes("viewthread")
    || /\/thread-[^/]+\.html$/.test(detail.pathname);
  const discuzPreset = rules.photoSelector === DISCUZ_FIRST_POST_PHOTO_SELECTOR;
  const discuzPhotos = discuzPreset || forumThread && !rules.photoSelector;
  const $ = document(html, discuzPhotos);
  if (discuzPhotos) {
    const thread = discuzThread(detail);
    if (!thread || thread.page !== 1) return [];
    if (discuzPreset && !applyDiscuzPhotoPreset($)) return [];
    const body = discuzFirstPostBody($);
    // A missing, hidden or empty first floor is authoritative; replies are not a fallback.
    return body ? discuzPostPhotos($, body, detail) : [];
  }
  const articles = visibleArticles($);
  const article = articles.length === 1
    && !articles.find('input[type="password"], [data-sitekey], #challenge-form').length ? articles : null;
  return detailPhotoUrls($, html, detail, rules, article ? cleanArticleBody($, article) : null);
}
