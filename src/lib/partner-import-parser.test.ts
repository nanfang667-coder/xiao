import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { DEFAULT_PARTNER_IMPORT_RULES, PartnerParseError, normalizePartnerImportRules, parsePartnerListing, parsePartnerImageUrls } from "./partner-import-parser.ts";

const rules = DEFAULT_PARTNER_IMPORT_RULES;
const pageUrl = "https://partner.example/catalog?page=2";
const card = (href: string) => `<a href="${href}"><h2>虚构示例</h2></a>`;

// These fixtures contain synthetic content only. Tests never make network or database calls.
test("listing imports only the supplied page's same-origin detail cards and deduplicates fragments", () => {
  const html = `
    <base href="https://other.example/">
    ${card("/listing/42#photos")}${card("/listing/42")}
    ${card("https://partner.example/teacher/43?version=2")}
    ${card("https://other.example/listing/44")}
    <a href="?page=3" rel="next"><h2>下一页</h2></a>
    ${card("/listing/page/3")}${card("/listing/new")}
    <a href="/listing/47">不是帖子卡片</a>
    <script>self.__next_f.push([1, '${card("/listing/99")}'])</script>
  `;
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), [
    "https://partner.example/listing/42",
    "https://partner.example/teacher/43?version=2",
  ]);
});

test("listing excludes advertising, navigation, hidden content, credentials and unsafe links", () => {
  const html = `${card("/listing/42")}
    <nav>${card("/listing/1")}</nav><header>${card("/listing/2")}</header>
    <footer>${card("/listing/3")}</footer><aside>${card("/listing/4")}</aside>
    <div data-ad>${card("/listing/5")}</div><div class="pagination">${card("/listing/6")}</div>
    <div hidden>${card("/listing/7")}</div><div data-import-ignore>${card("/listing/8")}</div>
    <a href="/listing/9" rel="next"><h2>下一页</h2></a>
    ${card("https://user:secret@partner.example/listing/10")}
    ${card("javascript:alert('/listing/11')")}
    <template>${card("/listing/12")}</template><section aria-label="全国推广">${card("/listing/13")}</section>`;
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), ["https://partner.example/listing/42"]);
});

test("custom post selectors support other detail paths but never follow pagination or cross-origin links", () => {
  const custom = { postLinkSelector: ".post" };
  const html = '<a class="post" href="/posts/21">虚构帖子</a><a class="post" href="?page=3">下一页</a><a class="post" href="https://elsewhere.example/posts/3">外站</a>';
  assert.deepEqual(parsePartnerListing(html, pageUrl, custom), ["https://partner.example/posts/21"]);
});

test("listing fails clearly instead of claiming a successful empty or truncated import", () => {
  assert.throws(() => parsePartnerListing('<a href="?page=2">下一页</a>', pageUrl, rules), /未找到本页帖子链接/);
  assert.throws(() => parsePartnerListing(Array.from({ length: 51 }, (_, i) => card(`/listing/${i}`)).join(""), pageUrl, rules), /超过 50/);
  assert.equal(parsePartnerListing(Array.from({ length: 50 }, (_, i) => card(`/listing/${i}`)).join(""), pageUrl, rules).length, 50);
});

for (const heading of ["h2", "h3", "h4"]) {
  test("default wrapped " + heading + " cards support safe unknown detail paths without mixing in long card metadata", () => {
    const html = '<a href="/information/123"><img src="/synthetic.jpg"><' + heading + '>虚构帖子标题</' + heading + '>'
      + '<p>' + '虚构简介'.repeat(100) + '</p><div>' + '13800000000'.repeat(40) + '</div></a>'
      + '<' + heading + '><a href="/posts/124">另一篇虚构标题</a></' + heading + '>';
    assert.deepEqual(parsePartnerListing(html, pageUrl, rules), [
      "https://partner.example/information/123", "https://partner.example/posts/124",
    ]);
  });
}

test("wrapped-card default recognition excludes non-post areas, unsafe routes and distinct multiple-title containers", () => {
  const wrapped = (href: string, title = "虚构帖子标题") => '<a href="' + href + '"><h3>' + title + '</h3></a>';
  const html = wrapped("/information/123")
    + ["nav", "header", "footer", "aside"].map(tag => '<' + tag + '>' + wrapped('/information/' + tag) + '</' + tag + '>').join('')
    + '<div data-ad>' + wrapped('/information/ad') + '</div>'
    + ["ad", "ads", "advert"].map(className => '<div class="' + className + '">' + wrapped('/offers/' + className, '虚构促销内容') + '</div>').join('')
    + '<div hidden>' + wrapped('/information/hidden') + '</div>'
    + '<div class="pagination">' + wrapped('/information/pagination') + '</div>'
    + wrapped('https://other.example/information/124') + wrapped('/login') + wrapped('/category/news')
    + wrapped('/catalog?page=3') + wrapped('/information/next', '下一页')
    + '<a href="/information/container"><h2>第一篇虚构标题</h2><h3>第二篇虚构标题</h3></a>'
    + '<a href="/information/advert-title"><span data-ad><h2>虚构广告标题</h2></span></a>';
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), ["https://partner.example/information/123"]);
});

test("wrapped cards may repeat one responsive title without treating numeric or empty headings as extra posts", () => {
  const html = '<a href="/information/123"><h2>同一篇虚构标题</h2><h3>同一篇虚构标题</h3>'
    + '<h4>10000</h4><h4></h4><p>' + '其他卡片文字'.repeat(100) + '</p></a>';
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), ["https://partner.example/information/123"]);
});

test("missing href, onclick cards and static script lists do not manufacture detail routes", () => {
  for (const html of [
    '<a><h2>虚构帖子标题</h2></a>',
    '<div class="clickable" onclick="location.href=\'/information/123\'"><h3>虚构帖子标题</h3></div>',
    '<script id="__NUXT_DATA__" type="application/json">[{"posts":[{"id":123,"title":"虚构标题","url":"/information/123"}]}]</script>',
    '<script>throw new Error("must not execute");</script><div>虚构列表外壳</div>',
  ]) assert.throws(() => parsePartnerListing(html, pageUrl, rules), { code: "LISTING_NO_MATCH" });
  assert.throws(() => parsePartnerListing('<div class="clickable" onclick="location.href=\'/information/123\'">虚构标题</div>', pageUrl, {
    postLinkSelector: ".clickable",
  }), { code: "LISTING_NO_SAFE_LINKS" });
});

test("missing, previous-default and legacy source rules all upgrade to wrapped-card recognition without changing custom rules", () => {
  const legacy = 'a[href*="/listing/"]:has(h2), a[href*="/teacher/"]:has(h2)';
  const previous = legacy + ', h1 a[href], h2 a[href], h3 a[href], h4 a[href]';
  const html = '<a href="/information/123"><h4>虚构帖子标题</h4></a>';
  for (const postLinkSelector of [undefined, legacy, previous, rules.postLinkSelector]) {
    const sourceRules = {
      ...(postLinkSelector === undefined ? {} : { postLinkSelector }),
      fields: { name: ".source-title" }, photoSelector: ".source-gallery img",
      nextPageSelector: ".next", pageUrlTemplate: "/catalog?page={page}",
    };
    const normalized = normalizePartnerImportRules(sourceRules);
    assert.deepEqual(normalized, { ...sourceRules, postLinkSelector: rules.postLinkSelector });
    assert.deepEqual(parsePartnerListing(html, pageUrl, normalized), ["https://partner.example/information/123"]);
  }
  const custom = { postLinkSelector: "a.specific" };
  assert.deepEqual(normalizePartnerImportRules(custom), custom);
  assert.throws(() => parsePartnerListing(html, pageUrl, custom), { code: "LISTING_NO_MATCH" });
  assert.deepEqual(parsePartnerListing('<a class="specific" href="/information/custom"><h2>一篇虚构标题</h2><h3>另一处文字</h3></a>', pageUrl, custom), [
    "https://partner.example/information/custom",
  ]);
});

test("rule validation rejects invalid syntax, unsupported fields, excessive length, and non-object values", () => {
  assert.deepEqual(normalizePartnerImportRules({}), rules);
  for (const value of [null, [], "selector", { fields: { unknown: "p" } }, { arbitrary: true }, { fields: { name: "" } }, { photoSelector: "[" }, { postLinkSelector: "a".repeat(501) }]) {
    assert.throws(() => normalizePartnerImportRules(value));
  }
});



test("persisted former defaults upgrade without replacing explicit field and photo mappings", () => {
  const legacy = {
    postLinkSelector: ' a[href*="/listing/"]:has(h2), a[href*="/teacher/"]:has(h2) ',
    fields: { name: ".title", services: ".body" },
    photoSelector: ".gallery img",
  };
  assert.deepEqual(normalizePartnerImportRules(legacy), { ...legacy, postLinkSelector: rules.postLinkSelector });
  assert.deepEqual(parsePartnerListing('<h2><a href="/information/123">虚构帖子标题</a></h2>', pageUrl, legacy), [
    "https://partner.example/information/123",
  ]);
});

for (const heading of ["h1", "h2", "h3", "h4"]) {
  test("default listing accepts 20 " + heading + " title links on unknown detail paths and deduplicates card images", () => {
    const entries = Array.from({ length: 20 }, (_, index) => {
      const href = "/information/" + (index + 123);
      return '<article class="entry"><a href="' + href + '"><img src="/sample.png"></a>'
        + "<" + heading + '><a href="' + href + '">虚构帖子标题 ' + index + "</a></" + heading + ">"
        + "<" + heading + '><a href="' + href + '#photos">虚构帖子标题 ' + index + "</a></" + heading + "></article>";
    }).join("");
    assert.deepEqual(parsePartnerListing("<main>" + entries + "</main>", pageUrl, rules),
      Array.from({ length: 20 }, (_, index) => "https://partner.example/information/" + (index + 123)));
  });
}

test("heading links exclude known directories, navigation, unsafe URLs, and pagination on any route", () => {
  const headingLink = (href: string, title = "虚构帖子标题") => '<h3><a href="' + href + '">' + title + "</a></h3>";
  const directories = ["category/news", "categories/news", "tag/sample", "tags/sample", "author/sample",
    "search/results", "login", "admin", "adminzhangzhang", "wp-admin", "wp-content/themes", "feed", "page/3",
    "information/page/3", "information/new", "information/create", "information/edit", "%63ategory/sample"];
  const html = headingLink("/information/123")
    + directories.map((path) => headingLink("/" + path)).join("")
    + headingLink("/catalog?page=3") + headingLink("/catalog/?page=4") + headingLink("/?page=2")
    + headingLink("/unknown/navigation", "查看更多") + headingLink("/unknown/empty", "")
    + headingLink("/unknown/image", '<img alt="虚构图片" src="/sample.png">')
    + headingLink("/unknown/number", "12345") + headingLink("/unknown/symbol", "→")
    + headingLink("https://elsewhere.example/information/124")
    + headingLink("https://name:password@partner.example/information/124")
    + headingLink("javascript:alert(1)") + headingLink("#section")
    + '<h2><a href="/information/125" rel="next">虚构帖子标题</a></h2>'
    + '<nav>' + headingLink("/information/126") + "</nav>"
    + '<div hidden>' + headingLink("/information/127") + "</div>"
    + '<div data-ad>' + headingLink("/information/128") + "</div>"
    + '<div class="pagination">' + headingLink("/information/129") + "</div>"
    + '<a href="/unknown/ordinary">虚构普通链接</a>';
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), ["https://partner.example/information/123"]);
});

test("a lone site h1 or repeated copies of one h1 destination are not post structures", () => {
  const html = '<div class="brand"><h1><a href="/about">虚构网站名称</a></h1></div>'
    + '<div class="banner"><h1><a href="/promo">虚构活动入口</a></h1><h1><a href="/promo">虚构活动入口</a></h1></div>'
    + '<section><h1><a href="/one">虚构网站入口</a><a href="/two">虚构其他入口</a></h1></section>'
    + '<h2><a href="/information/123">虚构帖子标题</a></h2>';
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules), ["https://partner.example/information/123"]);
});

test("repeated h1 cards allow unique and shared classes within one section without mixing sibling sections under an app wrapper", () => {
  const entries = Array.from({ length: 20 }, (_, index) => {
    const href = "/information/" + (index + 123);
    return '<article class="entry post-' + index + ' category-' + (index % 3) + '">'
      + '<div class="content content-' + index + '"><h1 class="title title-' + index + '">'
      + '<a href="' + href + '">虚构帖子标题 ' + index + "</a></h1></div></article>";
  }).join("");
  const bodyHeadings = '<section><div><h1><a href="/about">虚构网站介绍</a></h1></div></section>'
    + '<section><div><h1><a href="/contact">虚构网站联系</a></h1></div></section>';
  const html = '<div id="app">' + bodyHeadings + "<main><section>" + entries + "</section></main></div>";
  assert.deepEqual(parsePartnerListing(html, pageUrl, rules),
    Array.from({ length: 20 }, (_, index) => "https://partner.example/information/" + (index + 123)));
});

test("list and image errors remain typed and never expose raw page data after workflow removal", () => {
  const secret = "SYNTHETIC_PRIVATE_DATA";
  const cases: [() => unknown, string][] = [
    [() => parsePartnerListing(`<article>${secret}</article>`, pageUrl, rules), "LISTING_NO_MATCH"],
    [() => parsePartnerListing(card(`https://other.example/${secret}`), pageUrl, rules), "LISTING_NO_SAFE_LINKS"],
    [() => parsePartnerListing(card("/listing/42"), `file:///${secret}`, rules), "INVALID_URL"],
    [() => parsePartnerImageUrls("x".repeat(2_000_001), pageUrl, rules), "TOO_LARGE"],
    [() => parsePartnerImageUrls(secret, `https://user:${secret}@partner.example/post/42`, rules), "INVALID_URL"],
    [() => normalizePartnerImportRules({ photoSelector: "[", secret }), "INVALID_RULES"],
  ];
  for (const [run, code] of cases) {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof PartnerParseError);
      assert.equal(error.code, code);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

const forumList = "https://partner.example/bbs/forum.php?mod=forumdisplay&fid=2&filter=sortid&sortid=3&area=2";
const forumLink = (href: string, extra = "") => `<a class="s xst" href="${href}" ${extra}>虚构论坛标题</a>`;
const forumTable = (links: string) => `<div id="threadlist"><table id="threadlisttableid"><tbody id="normalthread_1"><tr><th>${links}</th></tr></tbody></table></div>`;

test("Discuz default titles allow strict same-path threads and deduplicate first-page thread URLs", () => {
  const html = forumTable(forumLink("forum.php?mod=viewthread&tid=21&extra=page%3D1")
    + forumLink("forum.php?mod=viewthread&tid=21&page=3")
    + forumLink("thread-22-2-1.html") + forumLink("thread-22-1-1.html"))
    + '<h2><a href="forum.php?mod=viewthread&tid=23">虚构旧标题样式</a></h2>';
  assert.deepEqual(parsePartnerListing(html, forumList, rules), [
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=21",
    "https://partner.example/bbs/thread-22-1-1.html",
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=23",
  ]);
});

test("Discuz candidates exclude navigation, profiles, unsafe thread parameters and hidden titles", () => {
  const rejected = [
    "forum.php?mod=forumdisplay&fid=3", "member.php?mod=space&uid=4",
    "forum.php?mod=viewthread", "forum.php?mod=viewthread&tid=0",
    "forum.php?mod=viewthread&tid=21&tid=22", "forum.php?mod=forumdisplay&mod=viewthread&tid=21",
    "forum.php?mod=viewthread&tid=21&goto=lastpost", "forum.php?mod=redirect&tid=21",
    "forum.php?mod=viewthread&tid=21&pid=4", "forum.php?mod=viewthread&tid=21&action=findpost",
    "forum.php?mod=viewthread&tid=21&authorid=4", "forum.php?mod=viewthread&tid=21&page=0",
    "forum.php?mod=viewthread&tid=9007199254740992", "https://other.example/bbs/forum.php?mod=viewthread&tid=21",
    "https://user:password@partner.example/bbs/forum.php?mod=viewthread&tid=21",
    "javascript:alert(1)", "#navigation", "/unrelated/post/7",
  ];
  const html = forumTable(rejected.map(href => forumLink(href)).join("")
    + forumLink("forum.php?mod=viewthread&tid=30", 'style="display:none"')
    + `<div hidden>${forumLink("forum.php?mod=viewthread&tid=31")}</div>`
    + `<div data-ad>${forumLink("forum.php?mod=viewthread&tid=32")}</div>`
    + forumLink("forum.php?mod=viewthread&tid=33"))
    + `<nav>${forumLink("forum.php?mod=viewthread&tid=34")}</nav>`
    + forumLink("forum.php?mod=viewthread&tid=35");
  assert.deepEqual(parsePartnerListing(html, forumList, rules), ["https://partner.example/bbs/forum.php?mod=viewthread&tid=33"]);
});

test("Discuz defaults stay contextual and explicit selectors remain authoritative", () => {
  const html = forumTable(forumLink("forum.php?mod=viewthread&tid=21"))
    + '<a class="manual" href="forum.php?mod=viewthread&tid=22">自定义标题</a>';
  assert.throws(() => parsePartnerListing(html, pageUrl, rules), { code: "LISTING_NO_MATCH" });
  assert.deepEqual(parsePartnerListing(html, forumList, { ...rules, postLinkSelector: "a.manual" }), [
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=22",
  ]);
  assert.throws(() => parsePartnerListing('<a class="manual" href="?mod=viewthread&tid=22">虚构标题</a>', pageUrl,
    { ...rules, postLinkSelector: "a.manual" }), { code: "LISTING_NO_SAFE_LINKS" });
  assert.deepEqual(parsePartnerListing(forumTable(forumLink("thread-21-1-1.html")),
    "https://partner.example/bbs/forum-2-1.html", rules), ["https://partner.example/bbs/thread-21-1-1.html"]);
});

test("Discuz list discovery keeps the fifty-post cap instead of silently truncating", () => {
  const html = forumTable(Array.from({ length: 51 }, (_, index) => forumLink(`forum.php?mod=viewthread&tid=${index + 1}`)).join(""));
  assert.throws(() => parsePartnerListing(html, forumList, rules), { code: "TOO_MANY_POSTS" });
});

test("Discuz custom themes can expose image-only thread cards without standard title containers", () => {
  const html = '<section class="synthetic-cards">'
    + '<a href="forum.php?mod=viewthread&amp;tid=41"><img src="/thumbnail-one.jpg"></a>'
    + '<a href="forum.php?mod=viewthread&amp;tid=42&amp;page=2"><img file="/original-two.jpg" src="static/image/common/none.gif"></a>'
    + '<a href="forum.php?mod=viewthread&amp;tid=41&amp;page=3"><img src="/duplicate.jpg"></a>'
    + '<a href="thread-43-1-1.html"><img data-src="/lazy.jpg" src="/placeholder.gif"></a>'
    + '</section>';
  assert.deepEqual(parsePartnerListing(html, forumList, rules), [
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=41",
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=42",
    "https://partner.example/bbs/thread-43-1-1.html",
  ]);
  assert.throws(() => parsePartnerListing(html, pageUrl, rules), { code: "LISTING_NO_MATCH" });
  assert.throws(() => parsePartnerListing(html, forumList, { ...rules, postLinkSelector: "a.manual" }), { code: "LISTING_NO_MATCH" });
});

test("Discuz image-only cards still reject avatars, controls, hidden media and unsafe thread identities", () => {
  const card = (href: string, content = '<img src="/cover.jpg">') => `<a href="${href}">${content}</a>`;
  const target = "forum.php?mod=viewthread&amp;tid=41";
  const rejected = [
    card(target, '<span class="avatar"><img src="/avatar.jpg"></span>'),
    card(target, '<img class="author-avatar" src="/avatar.jpg">'),
    card(target, '<img class="avatar" src="/avatar.jpg">查看帖子'),
    card(target, '<img src="static/image/common/icon.gif">查看帖子'),
    card(target, '<span class="sign"><img src="/signature.jpg"></span>'),
    card(target, '<img src="static/image/common/icon.gif">'),
    card(target, '<img src="javascript:alert(1)">'), card(target, '<img>'),
    card(target, '<img style="display:none" src="/hidden.jpg">'),
    card(target, '<span data-ad><img src="/ad.jpg"></span>'),
    card(target, '<img src="/next.jpg">下一页'),
    `<form>${card(target)}</form>`, `<button>${card(target)}</button>`,
    `<div class="pg">${card(target)}</div>`, `<nav>${card(target)}</nav>`,
    `<div class="author">${card(target)}</div>`, `<aside>${card(target)}</aside>`,
    `<div class="author">${card(target, '<img class="avatar" src="/avatar.jpg">查看帖子')}</div>`,
    `<form>${card(target, '<img src="/cover.jpg">查看帖子')}</form>`,
    card('forum.php?mod=viewthread&amp;tid=41&amp;goto=lastpost'),
    card('forum.php?mod=viewthread&amp;tid=41&amp;tid=42'),
    card('forum.php?mod=forumdisplay&amp;fid=3'), card('member.php?mod=space&amp;uid=41'),
    card('https://other.example/bbs/forum.php?mod=viewthread&amp;tid=41'),
  ];
  for (const html of rejected) {
    assert.throws(() => parsePartnerListing(html, forumList, rules), { code: "LISTING_NO_SAFE_LINKS" });
  }
  assert.throws(() => parsePartnerListing(Array.from({ length: 51 }, (_, index) =>
    card(`forum.php?mod=viewthread&amp;tid=${index + 1}`)).join(""), forumList, rules), { code: "TOO_MANY_POSTS" });
});

test("Discuz moderation forms can contain image-only thread lists without making controls into posts", () => {
  const card = (tid: number) => `<a href="forum.php?mod=viewthread&amp;tid=${tid}"><img src="/cover-${tid}.jpg"></a>`;
  const html = '<form id="moderate" method="post" action="forum.php?mod=topicadmin">'
    + `<input type="checkbox" name="moderate[]" value="41">${card(41)}${card(42)}`
    + `<button>${card(43)}</button><span role="button">${card(44)}</span>`
    + `<div class="avatar">${card(45)}</div><div data-ad>${card(46)}</div>`
    + `<a href="forum.php?mod=topicadmin&amp;action=delete"><img src="/delete.jpg"></a>`
    + '</form>';
  assert.deepEqual(parsePartnerListing(html, forumList, rules), [
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=41",
    "https://partner.example/bbs/forum.php?mod=viewthread&tid=42",
  ]);
  assert.throws(() => parsePartnerListing(html, pageUrl, rules), { code: "LISTING_NO_MATCH" });
  assert.throws(() => parsePartnerListing(html, forumList, { ...rules, postLinkSelector: "a.manual" }), { code: "LISTING_NO_MATCH" });
});

test("the moderation-form exception excludes ambiguous forms, login shells and challenge wrappers", () => {
  const card = '<a href="forum.php?mod=viewthread&amp;tid=41"><img src="/cover.jpg"></a>';
  for (const html of [
    `<form>${card}</form>`, `<form id="login">${card}</form>`,
    `<form id="moderate"><input type="password">${card}</form>`,
    `<form id="moderate"><div data-sitekey="synthetic"></div>${card}</form>`,
    `<form id="moderate"><div id="challenge-form"></div>${card}</form>`,
    `<form id="moderate">${card}</form><form id="moderate"></form>`,
  ]) assert.throws(() => parsePartnerListing(html, forumList, rules), { code: "LISTING_NO_SAFE_LINKS" });
  assert.throws(() => parsePartnerListing(`<form id="moderate" hidden>${card}</form>`, forumList, rules), {
    code: "LISTING_NO_MATCH",
  });
});
