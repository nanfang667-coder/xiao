import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { normalizePartnerPageUrlTemplate, parsePartnerImageNextPage, partnerImageStartPageUrl, PartnerImagePaginationError } from "./partner-image-pagination.ts";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { DEFAULT_PARTNER_IMPORT_RULES, normalizePartnerImportRules } from "./partner-import-parser.ts";

const origin = "https://partner.example";
const current = origin + "/catalog?page=1";
const next = origin + "/catalog?page=2";
const rules = DEFAULT_PARTNER_IMPORT_RULES;
const parse = (html: string) => parsePartnerImageNextPage(html, current, rules, 2);

test("Discuz next-page links preserve forum filters and deduplicate top and bottom pagination", () => {
  const forum = origin + "/forum.php?mod=forumdisplay&fid=2&filter=sortid&sortid=3&searchsort=1&area=2";
  const second = forum + "&page=2";
  const encoded = second.replaceAll("&", "&amp;");
  const html = `<div class="pg"><a href="${forum}">1</a><a class="nxt" href="${encoded}">下一页</a></div>`
    + `<div class="pg"><a class="nxt" href="${encoded}">下一页 »</a></div>`;
  assert.equal(parsePartnerImageNextPage(html, forum, rules, 2), second);
  const params = new URL(second).searchParams;
  assert.equal(params.get("sortid"), "3");
  assert.equal(params.get("area"), "2");
  assert.equal(parsePartnerImageNextPage(html, forum, { ...rules, nextPageSelector: ".chosen" }, 2), null);
});

test("Discuz pagination never follows hidden, disabled, unrelated or off-origin targets", () => {
  for (const html of [
    '<div class="pg"><a href="?page=2">下一页</a></div>',
    '<div class="pg"><a class="nxt" href="?page=2">下一篇</a></div>',
    '<div class="pg" hidden><a class="nxt" href="?page=2">下一页</a></div>',
    '<div class="pg"><a class="nxt" aria-disabled="true" href="javascript:;">下一页</a></div>',
    '<aside data-ad><div class="pg"><a class="nxt" href="?page=2">下一页</a></div></aside>',
  ]) assert.equal(parse(html), null);
  assert.throws(() => parse('<div class="pg"><a class="nxt" href="https://foreign.example/forum.php?page=2">下一页</a></div>'), {
    code: "UNSAFE_PAGINATION",
  });
  assert.throws(() => parse('<div class="pg"><a class="nxt" href="?page=2">下一页</a><a class="nxt" href="?page=3">下一页</a></div>'), {
    code: "AMBIGUOUS_PAGINATION",
  });
});

test("start URL remains unchanged without a template, while templates explicitly start at page one", () => {
  assert.equal(partnerImageStartPageUrl(current, rules), current);
  assert.equal(partnerImageStartPageUrl(origin + "/catalog?page=9", { ...rules, pageUrlTemplate: "?page={page}" }), current);
  assert.equal(partnerImageStartPageUrl(origin + "/catalog", { ...rules, pageUrlTemplate: "/posts/page/{page}" }), origin + "/posts/page/1");
  assert.equal(partnerImageStartPageUrl(current, { ...rules, pageUrlTemplate: origin + "/posts/{page}?sort=new" }), origin + "/posts/1?sort=new");
});

test("page templates generate only the specified second or third page without guessing HTML links", () => {
  const configured = { ...rules, pageUrlTemplate: "?page={page}" };
  const untrustedHtml = '<a rel="next" href="https://foreign.example/private">Next</a>';
  assert.equal(parsePartnerImageNextPage(untrustedHtml, current, configured, 2), next);
  assert.equal(parsePartnerImageNextPage("", next, configured, 3), origin + "/catalog?page=3");
});

test("bare relative template paths stay anchored at the origin across pages one, two and three", () => {
  const configured = { ...rules, pageUrlTemplate: "pages/{page}?sort=new" };
  const first = partnerImageStartPageUrl(origin + "/catalog/nested/index?page=9", configured);
  const second = parsePartnerImageNextPage("", first, configured, 2);
  assert.equal(first, origin + "/pages/1?sort=new");
  assert.equal(second, origin + "/pages/2?sort=new");
  assert.equal(parsePartnerImageNextPage("", second, configured, 3), origin + "/pages/3?sort=new");
});

test("template syntax requires one page marker in an HTTPS path or query and safe literal characters", () => {
  for (const template of [
    "?page={page}", "/pages/{page}", origin + "/catalog?page={page}", "pages/{page}?sort=new",
  ]) assert.equal(normalizePartnerPageUrlTemplate(template), template);
  for (const value of [
    null, 3, "", "/page/1", "/{page}/{page}", "/{page}/{other}", "/{page", "/{Page}",
    "http://partner.example/{page}", "https://user:PRIVATE@partner.example/{page}",
    "https://@partner.example/{page}", "https://partner.example:444/{page}",
    "/{page}#private", "/{page} hidden", " /{page}", "/{page}\\private", "/{page}\n",
    "https://{page}.partner.example/list", "https:partner.example/{page}", "/{page}/..", "/" + "x".repeat(2048) + "{page}",
  ]) assert.throws(() => normalizePartnerPageUrlTemplate(value), { code: "INVALID_PAGINATION" });
});

test("saved source normalization preserves pagination while old source rules keep their shape", () => {
  assert.deepEqual(normalizePartnerImportRules({}), rules);
  const configured = {
    ...rules, fields: { name: ".title" }, photoSelector: ".gallery img",
    nextPageSelector: " .pagination .next ", pageUrlTemplate: "/catalog?page={page}",
  };
  assert.deepEqual(normalizePartnerImportRules(configured), { ...configured, nextPageSelector: ".pagination .next" });
  for (const input of [
    { nextPageSelector: "[" }, { nextPageSelector: "" }, { nextPageSelector: 4 },
    { pageUrlTemplate: "?page=1" }, { pageUrlTemplate: null }, { pageUrlTemplate: "/{page}#fragment" },
  ]) assert.throws(() => normalizePartnerImportRules(input), { code: "INVALID_RULES" });
});

test("default discovery accepts explicit next relations and deduplicates equivalent relative and absolute links", () => {
  assert.equal(parse('<link rel="next" href="?page=2"><a rel="nofollow NEXT" href="' + next + '">More</a>'), next);
  assert.equal(parse('<a rel="prev" href="?page=0">Previous</a>'), null);
});

test("default discovery only recognizes clear next labels inside pagination navigation", () => {
  for (const html of [
    '<nav aria-label="Pagination"><a href="?page=2">Next →</a></nav>',
    '<div class="pagination"><a href="?page=2">下一页 »</a></div>',
    '<div role="navigation" aria-label="分页导航"><a href="?page=2" aria-label="下一页">›</a></div>',
    '<div data-pagination><a href="?page=2" title="Next Page">→</a></div>',
  ]) assert.equal(parse(html), next);
  assert.equal(parse('<nav><a href="?page=2">Next</a></nav><a href="?page=3">下一页</a>'), null);
  assert.equal(parse('<div class="pagination"><a href="?page=2">2</a><a href="?page=3">3</a></div>'), null);
  assert.equal(parse('<div class="pagination"><a href="/post/99">Next article</a></div>'), null);
});

test("a configured selector is authoritative and never falls back to guessed pagination", () => {
  const configured = { ...rules, nextPageSelector: ".chosen" };
  const html = '<a class="chosen" href="?page=2">Chosen</a><a rel="next" href="https://foreign.example/">Next</a>';
  assert.equal(parsePartnerImageNextPage(html, current, configured, 2), next);
  assert.equal(parsePartnerImageNextPage('<a rel="next" href="?page=2">Next</a>', current, configured, 2), null);
  assert.throws(() => parsePartnerImageNextPage('<div class="chosen"></div>', current, configured, 2), { code: "INVALID_PAGINATION" });
  assert.throws(() => parsePartnerImageNextPage("", current, { ...rules, nextPageSelector: "[" }, 2), { code: "INVALID_PAGINATION" });
});

test("scripts, templates, hidden ancestors and adverts cannot contribute pagination targets", () => {
  const rejected = '<a rel="next" href="https://foreign.example/private">Next</a>';
  const html = '<script>throw new Error("never executed");' + rejected + '</script>'
    + '<template>' + rejected + '</template><div hidden>' + rejected + '</div>'
    + '<div aria-hidden="true">' + rejected + '</div><div class="hidden">' + rejected + '</div>'
    + '<div style="display:none">' + rejected + '</div><div style="visibility:hidden">' + rejected + '</div>'
    + '<div data-ad>' + rejected + '</div><div class="advertisement">' + rejected + '</div>'
    + '<a rel="next" href="?page=2">Next</a>';
  assert.equal(parse(html), next);
});

test("explicitly disabled next links mark the last page instead of treating placeholder URLs as targets", () => {
  for (const html of [
    '<a rel="next" href="#" aria-disabled="true">Next</a>',
    '<div class="pagination"><a href="#" disabled>下一页</a></div>',
    '<div class="pagination"><span class="disabled"><a href="#">下一页</a></span></div>',
    '<div aria-disabled="true"><a rel="NEXT" href="javascript:void(0)">Next</a></div>',
  ]) {
    assert.equal(parse(html), null);
    assert.equal(parsePartnerImageNextPage(html, current, { ...rules, nextPageSelector: "a" }, 2), null);
  }
  assert.throws(() => parse('<a rel="next" href="#">Next</a>'), { code: "UNSAFE_PAGINATION" });
});

test("ambiguous distinct next links fail with a fixed message instead of picking a target", () => {
  assert.throws(() => parse('<a rel="next" href="?page=2">Next</a><a rel="next" href="?page=3&PRIVATE_TOKEN=secret">Next</a>'), error => {
    assert.ok(error instanceof PartnerImagePaginationError);
    assert.equal(error.code, "AMBIGUOUS_PAGINATION");
    assert.equal(String(error).includes("PRIVATE_TOKEN"), false);
    assert.equal(String(error).includes(origin), false);
    return true;
  });
});

test("unsafe or cross-site next links fail without trying a different candidate", () => {
  for (const href of [
    "https://foreign.example/?page=2", "http://partner.example/?page=2", "javascript:alert(1)",
    "https://user:PRIVATE@partner.example/?page=2", "https://@partner.example/?page=2",
    "https://partner.example:444/?page=2", "?page=2#private", "?page=2 PRIVATE", "?page=2\\private", "",
  ]) {
    assert.throws(() => parse('<a rel="next" href="' + href + '">Next</a><div class="pagination"><a href="?page=2">Next</a></div>'), {
      code: "UNSAFE_PAGINATION",
    });
  }
  assert.throws(() => parse('<a rel="next">Next</a>'), { code: "INVALID_PAGINATION" });
  assert.throws(() => partnerImageStartPageUrl(current, { ...rules, pageUrlTemplate: "https://foreign.example/{page}" }), { code: "UNSAFE_PAGINATION" });
  assert.throws(() => parsePartnerImageNextPage("", current, { ...rules, pageUrlTemplate: "//foreign.example/{page}" }, 2), { code: "UNSAFE_PAGINATION" });
});

test("self-loop links and templates fail instead of repeating the current page", () => {
  assert.throws(() => parse('<a rel="next" href="?page=1">Next</a>'), { code: "PAGINATION_LOOP" });
  assert.throws(() => parsePartnerImageNextPage("", next, { ...rules, pageUrlTemplate: "?page={page}" }, 2), { code: "PAGINATION_LOOP" });
});

test("page size bounds apply to UTF-8 bytes even before following a configured template", () => {
  assert.throws(() => parse("x".repeat(2_000_001)), { code: "INVALID_PAGINATION" });
  assert.throws(() => parse("虚".repeat(666_667)), { code: "INVALID_PAGINATION" });
  assert.throws(() => parsePartnerImageNextPage("x".repeat(2_000_001), current, { ...rules, pageUrlTemplate: "?page={page}" }, 2), { code: "INVALID_PAGINATION" });
});
