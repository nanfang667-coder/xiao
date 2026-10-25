import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { parsePartnerImageDetail } from "./partner-image-parser.ts";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { DEFAULT_PARTNER_IMPORT_RULES } from "./partner-import-parser.ts";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { DISCUZ_FIRST_POST_PHOTO_SELECTOR } from "./partner-discuz-image-rules.ts";

const url = "https://partner.example/information/123";
const rules = DEFAULT_PARTNER_IMPORT_RULES;
const parse = (html: string) => parsePartnerImageDetail(html, url, rules).photoUrls;

test("image-only articles do not require imported title or body fields", () => {
  assert.deepEqual(parse('<article><img src="/one.jpg"><img data-src="/two.jpg" src="/placeholder.jpg"></article>'), [
    "https://partner.example/one.jpg", "https://partner.example/two.jpg",
  ]);
  assert.deepEqual(parsePartnerImageDetail('<img data-import-photo src="/one.jpg">', url, {
    ...rules, fields: { name: ".missing-title", services: ".missing-body" },
  }).photoUrls, ["https://partner.example/one.jpg"]);
});

test("image-only discovery excludes avatars, adverts, comments, related posts and hidden media", () => {
  const html = '<nav><img data-import-photo src="/nav.jpg"></nav><article>'
    + '<div class="author"><img src="/author.jpg"></div>'
    + '<img src="/actual.jpg"><div class="avatar"><img src="/avatar.jpg"></div>'
    + '<aside><img src="/ad.jpg"></aside><div class="comments"><img src="/comment.jpg"></div>'
    + '<section class="related"><img src="/related.jpg"></section>'
    + '<div style="display:none"><img src="/hidden.jpg"></div></article>';
  assert.deepEqual(parse(html), ["https://partner.example/actual.jpg"]);
});

test("an explicit photo selector remains authoritative and can select an avatar deliberately", () => {
  const html = '<article><div class="avatar"><img src="/selected.jpg"></div><img src="/other.jpg"></article>';
  assert.deepEqual(parsePartnerImageDetail(html, url, { ...rules, photoSelector: ".avatar img" }).photoUrls, [
    "https://partner.example/selected.jpg",
  ]);
  assert.throws(() => parsePartnerImageDetail('<div class="photo"></div>', url, { ...rules, photoSelector: ".photo" }), {
    code: "INVALID_RULES",
  });
});

test("image URL discovery deduplicates and never truncates above eight images", () => {
  assert.deepEqual(parse('<article><img src="/one.jpg"><img src="/one.jpg#duplicate"></article>'), [
    "https://partner.example/one.jpg",
  ]);
  assert.equal(parse('<article>' + Array.from({ length: 8 }, (_, n) => `<img src="/${n}.jpg">`).join("") + '</article>').length, 8);
  assert.throws(() => parse('<article>' + Array.from({ length: 9 }, (_, n) => `<img src="/${n}.jpg">`).join("") + '</article>'), {
    code: "DETAIL_LIMIT",
  });
});

function flatPayload(value: unknown): unknown[] {
  const flat: unknown[] = [];
  function add(entry: unknown): number {
    const index = flat.length;
    flat.push(null);
    if (Array.isArray(entry)) flat[index] = entry.map(add);
    else if (entry && typeof entry === "object") flat[index] = Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, add(child)]));
    else flat[index] = entry;
    return index;
  }
  add(value);
  return flat;
}

test("Nuxt originals remain bound to the current article without importing text fields", () => {
  const payload = flatPayload({ data: { post: {
    id: 123, title: "虚构标题", content: "", imageList: [{ url: "https://media.example/original" }],
  } } });
  const html = '<article><h1>虚构标题</h1><img src="/thumbnail.jpg"></article>'
    + '<script id="__NUXT_DATA__" type="application/json">' + JSON.stringify(payload) + '</script>';
  assert.deepEqual(parse(html), ["https://media.example/original"]);
});

test("empty photo results and inert scripts never create guessed URLs", () => {
  assert.deepEqual(parse('<article><p>虚构文字</p></article><script>throw new Error("not executed")</script>'), []);
  assert.throws(() => parse('<article><img src="javascript:alert(1)"></article>'), { code: "INVALID_URL" });
});

const threadUrl = "https://partner.example/bbs/forum.php?mod=viewthread&tid=21";
const post = (id: number, content: string, floor = "1", attrs = "") => `<div id="post_${id}" ${attrs}><div class="pls"><img src="/avatar.jpg"></div>`
  + `<a id="postnum${id}"><em>${floor}</em><sup>#</sup></a><table><tr><td class="t_f" id="postmessage_${id}">${content}</td></tr></table>`
  + '<div class="sign"><img src="/signature.jpg"></div></div>';
const forumPage = (posts: string) => '<div id="postlist">' + posts + "</div>";
const parseForum = (html: string, detail = threadUrl) => parsePartnerImageDetail(html, detail, rules).photoUrls;

test("Discuz images use only explicitly marked first-floor media and lazy original URLs", () => {
  const html = forumPage(post(101, '<img id="aimg_1" file="data/attachment/forum/one.jpg" src="static/image/common/none.gif">'
    + '<img id="aimg_2" zoomfile="/original.jpg" file="/thumbnail.jpg" src="/placeholder.gif">'
    + '<img data-src="/lazy.jpg" src="/placeholder.jpg">'
    + '<img src="/plain.jpg"><img src="/static/image/smiley/default/smile.gif">'
    + '<div class="quote"><img src="/quote.jpg"></div><div data-ad><img src="/ad.jpg"></div>'
    + '<span style="display:none"><img file="/hidden.jpg"></span>')
    + post(102, '<img file="/reply.jpg">', "2"));
  assert.deepEqual(parseForum(html), [
    "https://partner.example/bbs/data/attachment/forum/one.jpg", "https://partner.example/original.jpg",
    "https://partner.example/lazy.jpg", "https://partner.example/plain.jpg",
  ]);
});

test("Discuz first-floor labels accept an explicit author role and SEO first pages", () => {
  const html = forumPage(post(101, '<img file="/first.jpg">', "楼主"));
  assert.deepEqual(parseForum(html, "https://partner.example/bbs/thread-21-1-1.html"), ["https://partner.example/first.jpg"]);
  assert.deepEqual(parseForum(forumPage('<div id="post_101" first="1"><div id="postmessage_101" class="t_f"><img file="/first.jpg"></div></div>')),
    ["https://partner.example/first.jpg"]);
});

test("Discuz hidden, empty, ambiguous or unmarked first floors never fall back to replies", () => {
  const reply = post(102, '<img file="/reply.jpg">', "2");
  for (const first of [
    post(101, ""), post(101, '<img file="/first.jpg">', "1", "hidden"),
    post(101, '<img file="/first.jpg">', "1", 'style="display:none"'),
    '<div id="post_101"><div id="postmessage_101" class="t_f"><img file="/unmarked.jpg"></div></div>',
    post(101, '<img file="/first.jpg">', "2"),
    '<div id="post_101"><a id="postnum101">1</a><div id="postmessage_101"><img file="/first.jpg"></div><div id="postmessage_101"><img file="/ambiguous.jpg"></div></div>',
  ]) assert.deepEqual(parseForum(forumPage(first + reply)), []);
  assert.deepEqual(parseForum(forumPage(reply)), []);
  assert.deepEqual(parseForum(forumPage(post(101, '<img file="/first.jpg">')) + forumPage(reply)), []);
});

test("Discuz non-first pages and reply-only routes cannot be misread as the first post", () => {
  const html = forumPage(post(101, '<img file="/first.jpg">'));
  for (const detail of [
    threadUrl + "&page=2", "https://partner.example/bbs/thread-21-2-1.html",
    threadUrl + "&goto=lastpost", threadUrl + "&authorid=9", threadUrl + "&tid=22",
  ]) assert.deepEqual(parseForum(html, detail), []);
});

test("Discuz custom photo selection wins but unsafe original attributes and excessive photos still fail", () => {
  const html = forumPage(post(101, '<img file="/first.jpg">') + post(102, '<img class="chosen" file="/chosen.jpg">', "2"));
  assert.deepEqual(parsePartnerImageDetail(html, threadUrl, { ...rules, photoSelector: ".chosen" }).photoUrls,
    ["https://partner.example/chosen.jpg"]);
  for (const source of ["javascript:alert(1)", "file:///private", "https://u:p@partner.example/one.jpg"]) {
    assert.throws(() => parseForum(forumPage(post(101, `<img file="${source}" src="/safe-placeholder.jpg">`))), { code: "INVALID_URL" });
  }
  const images = Array.from({ length: 9 }, (_, index) => `<img file="/${index}.jpg">`).join("");
  assert.throws(() => parseForum(forumPage(post(101, images))), { code: "DETAIL_LIMIT" });
});

function attachmentPost(id: number, body: string, attachments: string, floor = "1") {
  return `<div id="post_${id}"><a id="postnum${id}">${floor}#</a><div class="t_fsz">`
    + `<table><tr><td class="t_f" id="postmessage_${id}">${body}</td></tr></table>`
    + `<div class="pattl">${attachments}</div></div></div>`;
}

test("Discuz first-post attachments next to the message are collected from its bound content region", () => {
  const first = attachmentPost(101, "", '<img src="/one.jpg"><img src="/two.jpg"><img src="/three.jpg">');
  const reply = attachmentPost(102, "", '<img src="/reply.jpg">', "2");
  assert.deepEqual(parseForum(forumPage(first + reply)), [
    "https://partner.example/one.jpg", "https://partner.example/two.jpg", "https://partner.example/three.jpg",
  ]);
  assert.deepEqual(parseForum(forumPage(attachmentPost(101, '<img src="/one.jpg">', '<img src="/one.jpg"><img file="/two.jpg">'))), [
    "https://partner.example/one.jpg", "https://partner.example/two.jpg",
  ]);
});

test("Discuz attachment discovery stays inside the verified first-post region and exclusions", () => {
  const first = attachmentPost(101, "", '<div class="avatar"><img src="/avatar.jpg"></div>'
    + '<div data-ad><img src="/ad.jpg"></div><img hidden src="/hidden.jpg">'
    + '<div class="quote"><img src="/quote.jpg"></div><img src="static/image/common/icon.gif">'
    + '<div class="comments"><img src="/comment.jpg"></div>'
    + '<div class="t_fsz"><div class="pattl"><img src="/nested.jpg"></div></div>'
    + '<div id="post_103"><div class="pattl"><img src="/nested-reply.jpg"></div></div>'
    + '<img src="/actual.jpg">')
    + '<div class="pattl"><img src="/outside-region.jpg"></div>';
  assert.deepEqual(parseForum(forumPage(first)), ["https://partner.example/actual.jpg"]);
  const emptyFirst = attachmentPost(101, "", "");
  assert.deepEqual(parseForum(forumPage(emptyFirst + attachmentPost(102, "", '<img src="/reply.jpg">', "2"))), []);
  assert.deepEqual(parseForum(forumPage(emptyFirst) + '<div class="pattl"><img src="/outside-postlist.jpg"></div>'), []);
});

test("Discuz attachment regions reject ambiguity and retain URL, first-floor and image count limits", () => {
  const images = '<img src="/one.jpg">';
  const ambiguous = attachmentPost(101, '<div id="postmessage_999"></div>', images);
  assert.deepEqual(parseForum(forumPage(ambiguous)), []);
  assert.deepEqual(parseForum(forumPage(attachmentPost(101, "", images, "2"))), []);
  assert.deepEqual(parseForum(forumPage(attachmentPost(101, "", images)), threadUrl + "&page=2"), []);
  assert.throws(() => parseForum(forumPage(attachmentPost(101, "", '<img src="javascript:alert(1)">'))), { code: "INVALID_URL" });
  assert.throws(() => parseForum(forumPage(attachmentPost(101, '<img src="/body.jpg">',
    Array.from({ length: 8 }, (_, i) => `<img src="/attachment-${i}.jpg">`).join("")))), { code: "DETAIL_LIMIT" });
});

const parseForumPreset = (html: string, detail = threadUrl) => parsePartnerImageDetail(html, detail, {
  ...rules, photoSelector: DISCUZ_FIRST_POST_PHOTO_SELECTOR,
}).photoUrls;
const hiddenForum = (posts: string, attrs = 'style="display:none"') => `<div id="postlist" ${attrs}>${posts}</div>`;

test("the explicit Discuz source preset collects first-post attachments under only an initially hidden root", () => {
  const first = attachmentPost(101, "", '<img src="/one.jpg"><img src="/two.jpg"><img src="/three.jpg">');
  const html = hiddenForum(first + attachmentPost(102, "", '<img src="/reply.jpg">', "2"));
  assert.deepEqual(parseForum(html), []);
  assert.deepEqual(parseForumPreset(html), [
    "https://partner.example/one.jpg", "https://partner.example/two.jpg", "https://partner.example/three.jpg",
  ]);
  for (const style of ["DISPLAY : none !important; color:red", "color:red;display:none;", " display: none "]) {
    assert.equal(parseForumPreset(hiddenForum(first, `style="${style}"`)).length, 3);
  }
  assert.equal(parseForumPreset(forumPage(first)).length, 3);
});

test("the Discuz source preset retains semantic hiding, other hidden ancestors and challenge exclusions", () => {
  const first = attachmentPost(101, '<img src="/one.jpg">', '<img src="/two.jpg">');
  for (const attrs of [
    'hidden style="display:none"', 'aria-hidden="true" style="display:none"',
    'class="hidden" style="display:none"', 'class="d-none" style="display:none"',
    'style="display:none; visibility:hidden"', 'style="visibility:hidden;display:none"',
    'data-sitekey="synthetic" style="display:none"',
  ]) assert.deepEqual(parseForumPreset(hiddenForum(first, attrs)), []);
  for (const attrs of ['hidden', 'aria-hidden="true"', 'style="display:none"']) {
    assert.deepEqual(parseForumPreset(`<main ${attrs}>${hiddenForum(first)}</main>`), []);
  }
  for (const challenge of ['<input type="password">', '<div data-sitekey="synthetic"></div>', '<form id="challenge-form"></form>']) {
    assert.deepEqual(parseForumPreset(hiddenForum(challenge + first)), []);
    assert.deepEqual(parseForumPreset(forumPage(challenge + first)), []);
  }
  const nestedHidden = attachmentPost(101, '<span style="display:none"><img src="/hidden-body.jpg"></span>',
    '<div style="display:none"><img src="/hidden-attachment.jpg"></div><img src="/visible.jpg">');
  assert.deepEqual(parseForumPreset(hiddenForum(nestedHidden)), ["https://partner.example/visible.jpg"]);
});

test("the Discuz source preset never substitutes replies, ambiguous roots or later thread pages", () => {
  const reply = attachmentPost(102, "", '<img src="/reply.jpg">', "2");
  for (const first of [attachmentPost(101, "", ""), attachmentPost(101, "", '<img src="/wrong-floor.jpg">', "2"),
    post(101, '<img src="/hidden-first.jpg">', "1", 'style="display:none"'),
    '<div id="post_101"><div id="postmessage_101"><img src="/unmarked.jpg"></div></div>']) {
    assert.deepEqual(parseForumPreset(hiddenForum(first + reply)), []);
  }
  const html = hiddenForum(attachmentPost(101, "", '<img src="/first.jpg">'));
  assert.deepEqual(parseForumPreset(html + html), []);
  for (const detail of [threadUrl + "&page=2", threadUrl + "&goto=lastpost", url, "https://partner.example/bbs/thread-21-2-1.html"]) {
    assert.deepEqual(parseForumPreset(html, detail), []);
  }
});

test("the Discuz source preset keeps attachment boundaries, original URL validation and eight-image cap", () => {
  const first = attachmentPost(101, '<img src="/same.jpg">', '<img src="/same.jpg"><img file="/original.jpg" src="/thumb.jpg">'
    + '<div class="avatar"><img src="/avatar.jpg"></div><div class="quote"><img src="/quoted.jpg"></div>'
    + '<img src="/static/image/common/icon.gif"><div data-ad><img src="/ad.jpg"></div>'
    + '<div class="comments"><img src="/comment.jpg"></div>');
  assert.deepEqual(parseForumPreset(hiddenForum(first)), ["https://partner.example/same.jpg", "https://partner.example/original.jpg"]);
  for (const source of ["javascript:alert(1)", "file:///private", "https://u:p@partner.example/a.jpg"]) {
    assert.throws(() => parseForumPreset(hiddenForum(attachmentPost(101, "", `<img src="${source}">`))), { code: "INVALID_URL" });
  }
  const images = Array.from({ length: 9 }, (_, i) => `<img src="/${i}.jpg">`).join("");
  assert.throws(() => parseForumPreset(hiddenForum(attachmentPost(101, "", images))), { code: "DETAIL_LIMIT" });
});
