import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { DEFAULT_PARTNER_IMPORT_RULES, PartnerParseError, normalizePartnerImportRules, parsePartnerDetail, parsePartnerListing } from "./partner-import-parser.ts";

const rules = DEFAULT_PARTNER_IMPORT_RULES;
const pageUrl = "https://partner.example/catalog?page=2";
const detailUrl = "https://partner.example/listing/42";
const card = (href: string) => `<a href="${href}"><h2>虚构示例</h2></a>`;
const minimal = '<h1 data-import-field="name">虚构标题</h1><div data-import-field="services">虚构正文</div>';

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

test("default detail extraction matches the existing rendered site template", () => {
  const html = `
    <header><h1>网站导航</h1></header>
    <nav><span>面包屑</span></nav><aside><section><h2>服务内容</h2><p>广告正文</p></section></aside>
    <div class="grid grid-cols-2 gap-1"><button><img src="/images/sample-a.png"></button><button><img src="https://cdn.example/sample-b.jpg"></button></div>
    <div><div>📍 示例市 · 示例区</div><a href="/area">查看地区</a><h1>虚构标题<span>年龄28</span></h1><div class="text-rose-500">示例价格</div></div>
    <section><h2>服务内容</h2><p>第一行<br>第二行 &amp; 补充</p></section>
    <section><h2>补充说明</h2><p>示例说明</p></section>
    <section><h2>详细地址</h2><div><span>虚构地址</span></div></section>
    <section><h2>联系方式</h2><div>
      <div><span>电话</span><span>010-00000000</span></div>
      <div><span>微信</span><span>sample-wechat</span></div>
      <div><span>QQ</span><span>sample-qq</span></div>
      <div><span>其他</span><span>contact@example.invalid</span></div>
    </div></section>`;
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.deepEqual(result.fields, {
    name: "虚构标题", type: "", city: "示例市", district: "示例区", price: "",
    services: "第一行\n第二行 & 补充", courseNotes: "示例说明", age: "28",
    phone: "", wechat: "", qq: null,
    otherContact: null, address: null,
  });
  assert.deepEqual(result.photoUrls, ["https://partner.example/images/sample-a.png", "https://cdn.example/sample-b.jpg"]);
});

test("explicit data fields are plain text, retain paragraphs, and exclude scripts and hidden data", () => {
  const html = `<div data-import-field="name">虚构 &amp; 标题</div>
    <div data-import-field="services"><p>第一段 <b>加粗</b></p><p>第二段</p>
      <script>throw new Error('must not execute')</script><style>.secret{}</style>
      <iframe src="https://forbidden.invalid"></iframe><div hidden>隐藏文字</div><span aria-hidden="true">装饰</span>
    </div><div data-import-field="wechat">example-contact</div>`;
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.name, "虚构 & 标题");
  assert.equal(result.fields.services, "第一段 加粗\n第二段");
  assert.equal(result.fields.wechat, "");
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.courseNotes, null);
  assert.deepEqual(result.photoUrls, []);
});

test("custom field selectors take precedence over defaults and explicit data markers", () => {
  const html = `${minimal}<article><h2>选定标题</h2><div class="body"><p>选定正文</p></div></article><meta name="price" content="示例报价">`;
  const result = parsePartnerDetail(html, detailUrl, {
    ...rules,
    fields: { name: "article h2", services: "article .body", price: 'meta[name="price"]' },
  });
  assert.equal(result.fields.name, "选定标题");
  assert.equal(result.fields.services, "选定正文");
  assert.equal(result.fields.price, "");
});

test("missing optional contact fields remain empty for manual review without invented values", () => {
  const fields = parsePartnerDetail(minimal, detailUrl, rules).fields;
  assert.equal(fields.phone, "");
  assert.equal(fields.wechat, "");
  assert.equal(fields.qq, null);
  assert.equal(fields.city, "");
  assert.equal(fields.type, "");
});

test("missing required fields, login shells, scripts-only pages, and ambiguous mappings fail", () => {
  assert.throws(() => parsePartnerDetail('<h1>请登录</h1>', detailUrl, rules), /标题或正文/);
  assert.throws(() => parsePartnerDetail('<script type="application/json">{"name":"秘密","services":"秘密"}</script>', detailUrl, rules), /标题或正文/);
  assert.throws(() => parsePartnerDetail(`${minimal}<div data-import-field="name">另一个标题</div>`, detailUrl, rules), /多个区域/);
  assert.throws(() => parsePartnerDetail(minimal, detailUrl, { ...rules, fields: { services: ".missing" } }), /标题或正文/);
});

test("field limits reject oversized content without truncation", () => {
  assert.throws(() => parsePartnerDetail(`<h1 data-import-field="name">${"名".repeat(101)}</h1><p data-import-field="services">正文</p>`, detailUrl, rules), { code: "DETAIL_LIMIT" });
  assert.throws(() => parsePartnerDetail(`<h1 data-import-field="name">标题</h1><p data-import-field="services">${"文".repeat(4001)}</p>`, detailUrl, rules), { code: "DETAIL_LIMIT" });
});

test("photos use the gallery or explicit selectors, deduplicate, resolve lazy relative URLs, and ignore ads", () => {
  const html = `${minimal}<base href="https://wrong.example/">
    <img src="/logo.png">
    <div data-import-photos><img data-src="../images/sample.png" src="data:image/gif;base64,AA"><img src="/images/sample.png#fragment"></div>
    <div data-ad><img data-import-photo src="/ad.jpg"></div>
    <img class="chosen" src="https://cdn.example/photo.jpg">`;
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, ["https://partner.example/images/sample.png"]);
  assert.deepEqual(parsePartnerDetail(html, detailUrl, { ...rules, photoSelector: "img.chosen" }).photoUrls, ["https://cdn.example/photo.jpg"]);
});

test("unsafe, missing, and oversized photo sets fail rather than silently dropping pictures", () => {
  for (const src of ["javascript:alert(1)", "data:image/png;base64,AA", "file:///secret", "https://user:secret@example.invalid/photo.png"]) {
    assert.throws(() => parsePartnerDetail(`${minimal}<img data-import-photo src="${src}">`, detailUrl, rules), /图片网址无效/);
  }
  assert.throws(() => parsePartnerDetail(`${minimal}<img data-import-photo>`, detailUrl, rules), /图片网址无效/);
  assert.throws(() => parsePartnerDetail(`${minimal}<div class="photo">图片</div>`, detailUrl, { ...rules, photoSelector: ".photo" }), { code: "INVALID_RULES" });
  const photos = Array.from({ length: 9 }, (_, i) => `<img data-import-photo src="/sample-${i}.png">`).join("");
  assert.throws(() => parsePartnerDetail(minimal + photos, detailUrl, rules), { code: "DETAIL_LIMIT" });
  assert.equal(parsePartnerDetail(minimal + photos.replace('<img data-import-photo src="/sample-8.png">', ""), detailUrl, rules).photoUrls.length, 8);
});

test("rule validation rejects invalid syntax, unsupported fields, excessive length, and non-object values", () => {
  assert.deepEqual(normalizePartnerImportRules({}), rules);
  for (const value of [null, [], "selector", { fields: { unknown: "p" } }, { arbitrary: true }, { fields: { name: "" } }, { photoSelector: "[" }, { postLinkSelector: "a".repeat(501) }]) {
    assert.throws(() => normalizePartnerImportRules(value));
  }
});

test("page size and URL validation reject invalid input without returning private content in errors", () => {
  assert.throws(() => parsePartnerDetail("x".repeat(2_000_001), detailUrl, rules), /大小限制/);
  assert.throws(() => parsePartnerListing(card("/listing/42"), "file:///secret", rules), { code: "INVALID_URL" });
  assert.throws(() => parsePartnerDetail(minimal, "https://user:secret@partner.example/listing/42", rules), { code: "INVALID_URL" });
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

test("typed parse errors distinguish absent matches and rejected links without leaking page data", () => {
  const secret = "synthetic-private-marker";
  const cases: [() => unknown, string][] = [
    [() => parsePartnerListing('<div>' + secret + "</div>", pageUrl, rules), "LISTING_NO_MATCH"],
    [() => parsePartnerListing('<h2><a href="https://other.invalid/' + secret + '">虚构标题</a></h2>', pageUrl, rules), "LISTING_NO_SAFE_LINKS"],
    [() => normalizePartnerImportRules({ postLinkSelector: "[", secret }), "INVALID_RULES"],
    [() => parsePartnerDetail("<h1>" + secret + "</h1>", detailUrl, rules), "DETAIL_MISSING_FIELDS"],
    [() => parsePartnerDetail(minimal + '<h1 data-import-field="name">' + secret + "</h1>", detailUrl, rules), "DETAIL_AMBIGUOUS_FIELDS"],
    [() => parsePartnerDetail("x".repeat(2_000_001), detailUrl, rules), "TOO_LARGE"],
    [() => parsePartnerListing(card("/listing/42"), "file:///" + secret, rules), "INVALID_URL"],
    [() => parsePartnerListing(Array.from({ length: 51 }, (_, index) => card("/listing/" + index)).join(""), pageUrl, rules), "TOO_MANY_POSTS"],
    [() => parsePartnerDetail('<h1 data-import-field="name">' + secret.repeat(20) + '</h1><div data-import-field="services">正文</div>', detailUrl, rules), "DETAIL_LIMIT"],
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

const semanticArticle = (body: string) => "<article><h1>虚构文章标题</h1>" + body + "</article>";

test("semantic article fallback extracts only its body paragraphs and unmarked photos", () => {
  const html = '<header><h1>网站导航</h1><img src="/logo.png"></header><p>文章外文字</p>'
    + semanticArticle('<p>第一段 <b>正文</b><br>续行</p><div><p>第二段正文</p></div>'
      + '<figure><img data-src="../images/sample.png" src="data:image/gif;base64,AA"></figure>'
      + '<img src="/images/sample.png#same">')
    + '<footer><p>网站页脚</p><img src="/footer.png"></footer>';
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.name, "虚构文章标题");
  assert.equal(result.fields.services, "第一段 正文\n续行\n第二段正文");
  assert.deepEqual(result.photoUrls, ["https://partner.example/images/sample.png"]);
});

test("semantic body removes metadata, controls, navigation, ads, comments, related content and hidden content", () => {
  const discarded = '<nav>导航<img src="/nav.png"></nav><aside>侧栏<img src="/aside.png"></aside>'
    + '<div data-ad>广告<img src="/advert.png"></div><div hidden>隐藏文字<img src="/hidden.png"></div>'
    + '<div class="hidden">隐藏类<img src="/hidden-class.png"></div>'
    + '<div style="display: none">隐藏样式<img src="/hidden-style.png"></div>'
    + '<p style="visibility:hidden">隐藏样式二</p><div aria-hidden="true">隐藏语义</div>'
    + '<div class="post-meta">作者和日期<img src="/avatar.png"></div><time>昨天</time>'
    + '<div itemprop="author">文章作者</div><a rel="tag" href="/tag/example">文章标签</a>'
    + '<form><label>留言表单</label><input value="私人输入"></form><button>操作按钮</button>'
    + '<span role="button">控制按钮</span><div role="toolbar">工具栏</div>'
    + '<section id="comments"><article><p>用户评论</p><img src="/comment.png"></article></section>'
    + '<div class="related-posts"><p>相关推荐</p><img src="/related.png"></div>'
    + '<section><h2>最新评论</h2><p>评论文字</p><img src="/plain-comment.png"></section>'
    + '<div><h3>推荐阅读</h3><p>推荐文字</p><img src="/plain-related.png"></div>'
    + '<div class="social-share">分享链接</div><script>secret()</script><style>.secret{}</style>';
  const result = parsePartnerDetail(semanticArticle('<p>有效正文</p><img src="/main.png">' + discarded), detailUrl, rules);
  assert.equal(result.fields.services, "有效正文");
  assert.deepEqual(result.photoUrls, ["https://partner.example/main.png"]);
});

test("legacy service sections retain exact precedence and do not activate semantic photos", () => {
  const html = semanticArticle('<p>其他文章文字</p><section><h2>服务内容</h2><p>指定服务正文</p></section><img src="/unmarked.png">');
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.services, "指定服务正文");
  assert.deepEqual(result.photoUrls, []);
});

test("empty explicit services, markers, or legacy sections do not fall back to other article text", () => {
  const body = "<p>可见文章正文</p>";
  assert.throws(() => parsePartnerDetail(semanticArticle(body), detailUrl, {
    ...rules, fields: { services: ".missing" },
  }), { code: "DETAIL_MISSING_FIELDS" });
  assert.throws(() => parsePartnerDetail(semanticArticle(body + '<div data-import-field="services"></div>'), detailUrl, rules), {
    code: "DETAIL_MISSING_FIELDS",
  });
  assert.throws(() => parsePartnerDetail(semanticArticle(body + "<section><h2>服务内容</h2></section>"), detailUrl, rules), {
    code: "DETAIL_MISSING_FIELDS",
  });
  const explicit = parsePartnerDetail(semanticArticle(body + '<p class="chosen">显式正文</p><img src="/unmarked.png">'), detailUrl, {
    ...rules, fields: { services: ".chosen" },
  });
  assert.equal(explicit.fields.services, "显式正文");
  assert.deepEqual(explicit.photoUrls, []);
});

test("semantic fallback preserves explicit and marked photo selection precedence", () => {
  const body = '<p>有效文章正文</p><img src="/unmarked.png"><img class="chosen" src="/chosen.png">';
  assert.deepEqual(parsePartnerDetail(semanticArticle(body), detailUrl, { ...rules, photoSelector: ".missing" }).photoUrls, []);
  assert.deepEqual(parsePartnerDetail(semanticArticle(body), detailUrl, { ...rules, photoSelector: "img.chosen" }).photoUrls, [
    "https://partner.example/chosen.png",
  ]);
  assert.deepEqual(parsePartnerDetail(semanticArticle(body + "<div data-import-photos></div>"), detailUrl, rules).photoUrls, []);
  assert.deepEqual(parsePartnerDetail(semanticArticle(body + '<div data-import-photos><img src="/marked.png"></div>'), detailUrl, rules).photoUrls, [
    "https://partner.example/marked.png",
  ]);
});

test("semantic fallback rejects multiple articles, unrelated titles, empty or authentication shells", () => {
  const emptyCases = [
    "<h1>页面标题</h1><div><p>全页正文不是文章</p></div>",
    "<h1>页面标题</h1><article><p>文章不包含页面标题</p></article>",
    "<article><header><h1>尚不支持的文章页头标题</h1></header><p>正文</p></article>",
    semanticArticle("<img src='/photo.png'>"),
    semanticArticle("<form>登录表单</form><button>继续</button><nav>导航</nav>"),
    semanticArticle("<p>请登录访问</p><form><input type='password'></form>"),
    semanticArticle("<p>请完成验证</p><div data-sitekey='synthetic-key'></div>"),
    '<article hidden><h1>隐藏文章</h1><p>隐藏正文</p></article>',
    '<article style="display:none"><h1>隐藏文章</h1><p>隐藏正文</p></article>',
  ];
  for (const html of emptyCases) {
    assert.throws(() => parsePartnerDetail(html, detailUrl, rules), { code: "DETAIL_MISSING_FIELDS" });
  }
  assert.throws(() => parsePartnerDetail(semanticArticle("<p>正文</p>") + "<article><p>另一篇正文</p></article>", detailUrl, rules), {
    code: "DETAIL_AMBIGUOUS_FIELDS",
  });
  assert.throws(() => parsePartnerDetail("<article><h1>标题一</h1><h1>标题二</h1><p>正文</p></article>", detailUrl, rules), {
    code: "DETAIL_AMBIGUOUS_FIELDS",
  });
});

test("semantic fallback keeps existing body and image limits and rejects unsafe images", () => {
  assert.throws(() => parsePartnerDetail(semanticArticle("<p>" + "文".repeat(4001) + "</p>"), detailUrl, rules), { code: "DETAIL_LIMIT" });
  for (const src of ["javascript:alert(1)", "file:///secret", "https://user:secret@example.invalid/photo.png"]) {
    assert.throws(() => parsePartnerDetail(semanticArticle('<p>有效正文</p><img src="' + src + '">'), detailUrl, rules), {
      code: "INVALID_URL",
    });
  }
  assert.throws(() => parsePartnerDetail(semanticArticle("<p>有效正文</p><img>"), detailUrl, rules), { code: "INVALID_URL" });
  const images = Array.from({ length: 9 }, (_, index) => '<img src="/synthetic-' + index + '.png">').join("");
  assert.throws(() => parsePartnerDetail(semanticArticle("<p>有效正文</p>" + images), detailUrl, rules), { code: "DETAIL_LIMIT" });
});

test("semantic photos ignore galleries and empty photo markers outside the selected article", () => {
  const outside = '<section class="related"><div data-import-photos><img src="/outside.png"></div></section>';
  const main = semanticArticle('<p>有效文章正文</p><img src="/inside.png">');
  assert.deepEqual(parsePartnerDetail(outside + main, detailUrl, rules).photoUrls, ["https://partner.example/inside.png"]);
  assert.deepEqual(parsePartnerDetail("<div data-import-photos></div>" + main, detailUrl, rules).photoUrls, ["https://partner.example/inside.png"]);
});

test("semantic body keeps supported gallery button photos while discarding button labels and unrelated controls", () => {
  const body = '<p>有效文章正文</p><div class="grid grid-cols-2"><button>打开图片<img src="/gallery.png"></button></div>'
    + '<button>分享<img src="/control-icon.png"></button>';
  const result = parsePartnerDetail(semanticArticle(body), detailUrl, rules);
  assert.equal(result.fields.services, "有效文章正文");
  assert.deepEqual(result.photoUrls, ["https://partner.example/gallery.png"]);
});

test("semantic gallery button cleanup cannot discard exclusion attributes before checking them", () => {
  for (const attributes of ['data-ad', 'data-import-ignore', 'class="hidden"', 'style="display:none"',
    'style="visibility:hidden"', 'aria-hidden="true"', 'hidden', 'class="post-meta"']) {
    const html = semanticArticle('<p>有效文章正文</p><div class="grid grid-cols-2"><button ' + attributes
      + '><img src="/discarded.png"></button><button><img src="/allowed.png"></button></div>');
    const result = parsePartnerDetail(html, detailUrl, rules);
    assert.equal(result.fields.services, "有效文章正文");
    assert.deepEqual(result.photoUrls, ["https://partner.example/allowed.png"]);
  }
});

test("default semantic photos exclude explicit avatar and author markers while retaining article originals", () => {
  const authorImages = '<img class="avatar" src="/avatar.png">'
    + '<img class="gravatar" src="/gravatar.png"><img class="author-avatar" src="/author-avatar.png">'
    + '<img class="user-avatar" src="/user-avatar.png"><img class="profile-avatar" src="/profile-avatar.png">'
    + '<img id="avatar" src="/id-avatar.png"><img data-avatar src="/data-avatar.png">'
    + '<div class="author-info"><img src="/author-info.png"></div>'
    + '<div class="post-author"><img src="/post-author.png"></div>'
    + '<div itemprop="author"><img src="/semantic-author.png"></div>';
  const html = semanticArticle('<p>有效文章正文</p>' + authorImages
    + '<img src="/original-a.jpg"><figure><img src="/original-b.jpg"></figure>');
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, [
    "https://partner.example/original-a.jpg", "https://partner.example/original-b.jpg",
  ]);
});

test("avatar-only articles no longer report an author picture as a post photo", () => {
  const html = semanticArticle('<p>有效文章正文</p><img class="avatar" src="/avatar.png">');
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, []);
});

test("avatar default markers cannot override exclusion or suppress unmarked semantic originals", () => {
  const html = semanticArticle('<p>有效文章正文</p><img data-import-photo class="avatar" src="/avatar.png">'
    + '<img src="/original.jpg">');
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, ["https://partner.example/original.jpg"]);
  const marked = semanticArticle('<p>有效文章正文</p><div data-import-photos><img class="avatar" src="/avatar.png">'
    + '<img src="/marked-original.jpg"></div><img src="/unselected.jpg">');
  assert.deepEqual(parsePartnerDetail(marked, detailUrl, rules).photoUrls, ["https://partner.example/marked-original.jpg"]);
});

test("legacy galleries retain normal photos while avatar filtering leaves explicit photo selectors authoritative", () => {
  const html = minimal + '<div class="grid grid-cols-2"><button><img class="avatar" src="/avatar.png"></button>'
    + '<button><img src="/original.jpg"></button></div>';
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, ["https://partner.example/original.jpg"]);
  assert.deepEqual(parsePartnerDetail(html, detailUrl, { ...rules, photoSelector: "img.avatar" }).photoUrls, [
    "https://partner.example/avatar.png",
  ]);
});

test("avatar exclusion does not use arbitrary alt text, dimensions or URL words", () => {
  const html = semanticArticle('<p>有效文章正文</p><img src="/art/avatar-study.jpg" alt="avatar" width="48" height="48">');
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, ["https://partner.example/art/avatar-study.jpg"]);
});

test("avatar markers on gallery buttons remain effective before button cleanup", () => {
  const html = semanticArticle('<p>有效文章正文</p><div class="grid grid-cols-2">'
    + '<button class="avatar"><img src="/avatar.png"></button><button><img src="/original.jpg"></button></div>');
  assert.deepEqual(parsePartnerDetail(html, detailUrl, rules).photoUrls, ["https://partner.example/original.jpg"]);
});

function staticGallery(urls: string[], id = "42", title = "虚构标题"): string {
  const flat: unknown[] = [{ data: 1 }, { article: 2 }, { id: 3, title: 4, content: 5, imageList: 6 }, id, title, "虚构正文", []];
  const items = flat[6] as number[];
  for (const url of urls) {
    items.push(flat.length);
    flat.push({ url: flat.length + 1 }, url);
  }
  return '<script id="__NUXT_DATA__" type="application/json">' + JSON.stringify(flat).replaceAll("<", "\\u003c") + "</script>";
}
const staticArticle = '<article><h1>虚构标题</h1><p>虚构正文</p><div class="author-info"><img src="/avatar.jpg"></div><img src="/thumbnail.jpg"></article>';

test("default photos use the bound static gallery, not the author avatar or DOM thumbnail", () => {
  const urls = ["https://media.example/opaque-a", "https://media.example/opaque-b", "https://media.example/opaque-c"];
  const result = parsePartnerDetail(staticArticle + staticGallery(urls), detailUrl, rules);
  assert.deepEqual(result.photoUrls, urls);
  assert.equal(result.fields.name, "虚构标题");
  assert.equal(result.fields.services, "虚构正文");
});

test("a bound empty static gallery is authoritative and does not restore unrelated DOM images", () => {
  assert.deepEqual(parsePartnerDetail(staticArticle + staticGallery([]), detailUrl, rules).photoUrls, []);
});

test("static galleries cannot cross current post IDs or article titles", () => {
  for (const gallery of [staticGallery(["https://media.example/wrong"], "43"), staticGallery(["https://media.example/wrong"], "42", "另一个虚构标题")]) {
    assert.deepEqual(parsePartnerDetail(staticArticle + gallery, detailUrl, rules).photoUrls, ["https://partner.example/thumbnail.jpg"]);
  }
});

test("explicit photo selectors and data markers keep priority over static galleries", () => {
  const gallery = staticGallery(["https://media.example/unused"]);
  const custom = { ...rules, photoSelector: ".author-info img" };
  assert.deepEqual(parsePartnerDetail(staticArticle + gallery, detailUrl, custom).photoUrls, ["https://partner.example/avatar.jpg"]);
  const marked = staticArticle.replace('src="/thumbnail.jpg"', 'data-import-photo src="/thumbnail.jpg"');
  assert.deepEqual(parsePartnerDetail(marked + gallery, detailUrl, rules).photoUrls, ["https://partner.example/thumbnail.jpg"]);
});

test("explicit body mapping still permits static photos bound to the unique article h1", () => {
  const custom = { ...rules, fields: { services: "article p" } };
  assert.deepEqual(parsePartnerDetail(staticArticle + staticGallery(["https://media.example/photo"]), detailUrl, custom).photoUrls, ["https://media.example/photo"]);
});

test("static photo extraction does not bind an article hidden with inline styles", () => {
  const html = staticArticle.replace("<article>", '<article style="display:none">') + staticGallery(["https://media.example/photo"]);
  assert.deepEqual(parsePartnerDetail(html, detailUrl, { ...rules, fields: { services: "article p" } }).photoUrls, []);
});

const labeledRows = (rows: [string, string][]) => "<table><tbody>" + rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("") + "</tbody></table>";
const labeledArticle = (rows: [string, string][], extra = "") => `<article><h1>虚构标题</h1>${labeledRows(rows)}${extra}</article>`;

test("two-column source fields map to separate draft fields and discard appearance", () => {
  const html = labeledArticle([
    ["服务", "<p>虚构服务第一项</p><p>虚构服务第二项</p>"], ["年龄", "28"],
    ["颜值", "不应保存的虚构外貌描述"], ["价格", "虚构费用"],
    ["微信", "fictional-wechat"], ["QQ", "10000"], ["电话", "010-00000000"],
    ["地址", "虚构地址"], ["城市", "虚构城市"], ["区域", "虚构区县"],
    ["备注", "虚构补充说明"], ["其他联系方式", "fictional@example.invalid"],
  ], '<p>不应混进服务的无关尾部文字</p>') + staticGallery(["https://media.example/fictional"]);
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.deepEqual(result.fields, {
    name: "虚构标题", type: "", city: "虚构城市", district: "虚构区县", price: "",
    services: "虚构服务第一项\n虚构服务第二项", age: "28", phone: "",
    wechat: "", qq: null, address: null,
    courseNotes: "虚构补充说明", otherContact: null,
  });
  assert.deepEqual(result.photoUrls, ["https://media.example/fictional"]);
  assert.doesNotMatch(JSON.stringify(result.fields), /外貌描述|无关尾部/);
});

test("explicit age overrides source labels while source price stays blank", () => {
  const html = labeledArticle([
    ["服务内容", "虚构指定服务"], ["年龄", "20"], ["年龄", "21"], ["价格", "甲"], ["费用", "乙"],
  ], '<div id="selected-age">29</div><div data-import-field="price">虚构指定价格</div>');
  const result = parsePartnerDetail(html, detailUrl, { ...rules, fields: { age: "#selected-age" } });
  assert.equal(result.fields.age, "29");
  assert.equal(result.fields.price, "");
  assert.equal(result.fields.services, "虚构指定服务");
});

test("structured articles cannot fall back to all text when the service field is empty or absent", () => {
  for (const rows of [[["年龄", "28"], ["颜值", "虚构外貌"]], [["服务", ""], ["年龄", "28"]]] as [string, string][][]) {
    assert.throws(() => parsePartnerDetail(labeledArticle(rows), detailUrl, rules), error => error instanceof PartnerParseError && error.code === "DETAIL_MISSING_FIELDS");
  }
});

test("repeated structured age or service labels reject the draft with fixed diagnostics", () => {
  for (const rows of [[["服务", "虚构服务"], ["年龄", "28"], ["年龄", "29"]], [["服务", "虚构服务"], ["服务内容", "另一项虚构服务"]]] as [string, string][][]) {
    assert.throws(() => parsePartnerDetail(labeledArticle(rows), detailUrl, rules), error => {
      assert.equal((error as { code?: string }).code, "DETAIL_AMBIGUOUS_FIELDS");
      assert.doesNotMatch(String(error), /虚构服务|另一项/);
      return true;
    });
  }
});

test("per-field length limits apply after mapping and ignore discarded appearance values", () => {
  for (const rows of [[["服务", "长".repeat(4001)]], [["服务", "虚构服务"], ["年龄", "1".repeat(51)]]] as [string, string][][]) {
    assert.throws(() => parsePartnerDetail(labeledArticle(rows), detailUrl, rules), error => error instanceof PartnerParseError && error.code === "DETAIL_LIMIT");
  }
  const result = parsePartnerDetail(labeledArticle([["服务", "虚构服务"], ["颜值", "丢弃".repeat(3000)]]), detailUrl, rules);
  assert.equal(result.fields.services, "虚构服务");
});

test("unlabeled prose, explicit service rules and legacy template sections retain their precedence", () => {
  const custom = parsePartnerDetail(labeledArticle([["服务", "虚构表格服务"], ["年龄", "28"]], '<p id="mapped-service">虚构显式服务</p>'), detailUrl, { ...rules, fields: { services: "#mapped-service" } });
  assert.equal(custom.fields.services, "虚构显式服务");
  const legacy = parsePartnerDetail(labeledArticle([["服务", "虚构表格服务"]], '<section><h2>服务内容</h2><p>虚构原模板服务</p></section>'), detailUrl, rules);
  assert.equal(legacy.fields.services, "虚构原模板服务");
  const plain = parsePartnerDetail('<article><h1>虚构标题</h1><p>年龄只是介绍的一部分，服务也只是普通用词。</p></article>', detailUrl, rules);
  assert.equal(plain.fields.services, "年龄只是介绍的一部分，服务也只是普通用词。");
});

test("each missing field can use the labeled article even with explicit or legacy services", () => {
  for (const scenario of [
    { extra: '<p id="explicit-services">虚构指定服务</p>', rules: { ...rules, fields: { services: "#explicit-services" } } },
    { extra: '<section><h2>服务内容</h2><p>虚构指定服务</p></section>', rules },
    { extra: '<p data-import-field="services">虚构指定服务</p>', rules },
  ]) {
    const result = parsePartnerDetail(labeledArticle([["服务", "虚构表格服务"], ["年龄", "28"]], scenario.extra), detailUrl, scenario.rules);
    assert.equal(result.fields.services, "虚构指定服务");
    assert.equal(result.fields.age, "28");
  }
});

test("optional field mapping does not make custom multi-article extraction fail", () => {
  const html = '<article><h1 id="selected-name">虚构标题</h1><p id="selected-body">虚构正文</p></article><article><h1>另一个标题</h1><p>其他正文</p></article>';
  const result = parsePartnerDetail(html, detailUrl, { ...rules, fields: { name: "#selected-name", services: "#selected-body" } });
  assert.equal(result.fields.name, "虚构标题");
  assert.equal(result.fields.services, "虚构正文");
});

test("empty legacy address and notes sections retain priority over labeled fallbacks", () => {
  const html = labeledArticle([["服务", "虚构服务"], ["地址", "虚构表格地址"], ["备注", "虚构表格备注"]],
    '<section><h2>详细地址</h2></section><section><h2>补充说明</h2></section>');
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.address, null);
  assert.equal(result.fields.courseNotes, null);
});

test("declaration text is stripped from unstructured articles while all post photos remain", () => {
  for (const heading of ["h2", "h3", "h4", "h5", "h6", "p"]) {
    const html = '<article><h1>虚构标题</h1><p>虚构服务</p><section><' + heading + '>声明信息</' + heading
      + '><p>虚构声明第一段</p><p>虚构声明第二段</p><img src="/synthetic-original.jpg"></section></article>';
    const result = parsePartnerDetail(html, detailUrl, rules);
    assert.equal(result.fields.services, "虚构服务");
    assert.deepEqual(result.photoUrls, ["https://partner.example/synthetic-original.jpg"]);
  }
});
test("declaration examples cannot leak into contact fields or displace genuine mapped fields", () => {
  const declaration = '<section><h2>声明信息</h2><p>电话：虚构声明电话</p><h3>声明子节</h3>'
    + labeledRows([["服务", "虚构声明服务"], ["微信", "虚构声明微信"]]) + '</section>';
  const result = parsePartnerDetail(labeledArticle([["服务", "虚构服务"], ["年龄", "28"], ["电话", "010-00000000"]], declaration), detailUrl, rules);
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.age, "28");
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.wechat, "");
});
test("declaration removal preserves the following peer section and normal mentions", () => {
  const html = '<article><h1>声明信息</h1><p>服务：阅读声明信息的普通介绍</p><h2>声明信息</h2><p>虚构声明</p>'
    + '<h3>声明子标题</h3><p>微信：虚构声明微信</p><h2>其他资料</h2><p>年龄：28</p></article>';
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.name, "声明信息");
  assert.equal(result.fields.services, "阅读声明信息的普通介绍");
  assert.equal(result.fields.age, "28");
  assert.equal(result.fields.wechat, "");
});
test("explicit, marked and legacy fields strip declaration tails before length validation", () => {
  const content = '虚构服务<br>声明信息：' + "丢弃".repeat(3000);
  for (const scenario of [
    { html: '<div id="service">' + content + '</div>', rules: { ...rules, fields: { services: "#service" } } },
    { html: '<div data-import-field="services">' + content + '</div>', rules },
    { html: '<section><h2>服务内容</h2><p>' + content + '</p></section>', rules },
  ]) {
    const result = parsePartnerDetail('<h1>虚构标题</h1>' + scenario.html, detailUrl, scenario.rules);
    assert.equal(result.fields.services, "虚构服务");
  }
});
test("a declaration-only service remains a missing required field", () => {
  for (const html of [
    '<article><h1>虚构标题</h1><h4>声明信息</h4><p>虚构声明正文</p></article>',
    '<h1>虚构标题</h1><div data-import-field="services">声明信息：虚构声明</div>',
    labeledArticle([["服务", "声明信息：虚构声明"]]),
  ]) assert.throws(() => parsePartnerDetail(html, detailUrl, rules), { code: "DETAIL_MISSING_FIELDS" });
});
test("declaration containers inside service cells cannot become nested contacts", () => {
  const html = labeledArticle([["服务", '<p>虚构服务</p><div><h4>声明信息</h4><p>电话：虚构声明电话</p></div>'], ["年龄", "28"]]);
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.age, "28");
});
test("declaration rows, definition values and label pairs are discarded as whole subtrees", () => {
  for (const declaration of [
    labeledRows([["声明信息", "<p>电话：虚构声明电话</p>"]]),
    "<dl><dt>声明信息</dt><dd><p>电话：虚构声明电话</p></dd></dl>",
    "<div><span>声明信息</span><div><p>电话：虚构声明电话</p></div></div>",
  ]) {
    const result = parsePartnerDetail(labeledArticle([["服务", "虚构服务"]], declaration), detailUrl, rules);
    assert.equal(result.fields.services, "虚构服务");
    assert.equal(result.fields.phone, "");
  }
});
test("declaration navigation and an empty declaration section cannot erase a following article", () => {
  for (const prefix of ['<nav><p>声明信息</p></nav>', '<section><h2>声明信息</h2></section>']) {
    const result = parsePartnerDetail(prefix + '<article><h1>虚构标题</h1><p>虚构服务</p></article>', detailUrl, rules);
    assert.equal(result.fields.services, "虚构服务");
  }
});

test("wrapped declaration headings retain their hierarchy and stop before another article", () => {
  const html = '<article><h1>虚构标题</h1><p>服务：虚构服务</p><div><h2>声明信息</h2></div>'
    + '<h3>子声明</h3><p>微信：虚构声明微信</p><h2>其他资料</h2><p>年龄：28</p></article>';
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.wechat, "");
  assert.equal(result.fields.age, "28");
  const separate = parsePartnerDetail('<div>声明信息</div><main><article><h1>虚构标题</h1><p>虚构服务</p></article></main>', detailUrl, rules);
  assert.equal(separate.fields.services, "虚构服务");
});


test("structured articles keep title introductions in notes and only the service value in services", () => {
  const html = '<article><p>标题前的无关说明</p><div><h1>虚构标题</h1></div>'
    + '<div class="post-meta">不应保存的作者</div><time>2026-01-01</time><nav>导航</nav>'
    + '<div>虚构介绍第一段<br>虚构介绍第二行</div><p>虚构介绍第二段</p>'
    + labeledRows([["服务", "虚构服务"], ["年龄", "28"], ["颜值", "不应保存"], ["微信", "source-contact"]])
    + '<p>表格后的无关正文</p><img src="/synthetic-photo.jpg"></article>';
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.courseNotes, "虚构介绍第一段\n\n虚构介绍第二行\n\n虚构介绍第二段");
  assert.equal(result.fields.age, "28");
  assert.equal(result.fields.wechat, "");
  assert.deepEqual(result.photoUrls, ["https://partner.example/synthetic-photo.jpg"]);
  assert.doesNotMatch(JSON.stringify(result.fields), /标题前|作者|2026-01|导航|不应保存|source-contact|无关正文/);
});

test("raw text introductions stop at labeled lines, pairs, tables or the next section", () => {
  for (const start of [
    '原始介绍文字<br>电话：source-contact<br>不应导入的电话续行',
    '<div>原始介绍文字</div><div><span>价格</span><span>source-price</span></div><p>不应导入</p>',
    '<p>原始介绍文字</p><h2>后续章节</h2><p>不应导入</p>',
    '<p>原始介绍文字</p><dl><dt>电话</dt><dd>source-contact</dd></dl><p>不应导入</p>',
  ]) {
    const html = '<article><div><div><h1>虚构标题</h1></div></div>' + start
      + labeledRows([["服务", "虚构服务"]]) + '</article>';
    const result = parsePartnerDetail(html, detailUrl, rules);
    assert.equal(result.fields.courseNotes, "原始介绍文字");
    assert.equal(result.fields.services, "虚构服务");
    assert.doesNotMatch(JSON.stringify(result.fields), /source-contact|source-price|不应导入|后续章节/);
  }
});

test("table notes and introductions merge without repeating equal paragraphs", () => {
  const html = '<article><h1>虚构标题</h1><p>第一段介绍</p><p>重复段落</p>'
    + labeledRows([["服务", "虚构服务"], ["备注", "<p>重复段落</p><p>额外说明</p>"]]) + '</article>';
  assert.equal(parsePartnerDetail(html, detailUrl, rules).fields.courseNotes, "第一段介绍\n\n重复段落\n\n额外说明");
});

test("explicit, marked and legacy notes retain priority including deliberately empty notes", () => {
  for (const note of ["", "优先说明"]) {
    for (const scenario of [
      { tail: '<div id="selected-notes">' + note + '</div>', rules: { ...rules, fields: { courseNotes: "#selected-notes" } } },
      { tail: '<div data-import-field="courseNotes">' + note + '</div>', rules },
      { tail: '<section><h2>补充说明</h2><p>' + note + '</p></section>', rules },
    ]) {
      const html = '<article><h1>虚构标题</h1><p>不应覆盖指定说明的介绍</p>'
        + labeledRows([["服务", "虚构服务"], ["备注", "表格说明"]]) + scenario.tail + '</article>';
      assert.equal(parsePartnerDetail(html, detailUrl, scenario.rules).fields.courseNotes, note || null);
    }
  }
});

test("ordinary unstructured prose is never duplicated into introduction notes", () => {
  const result = parsePartnerDetail('<article><h1>虚构标题</h1><p>普通文章第一段</p><p>普通文章第二段</p></article>', detailUrl, rules);
  assert.equal(result.fields.services, "普通文章第一段\n普通文章第二段");
  assert.equal(result.fields.courseNotes, null);
});

test("manual price, address and contacts ignore selectors, markers and repeated oversized source fields", () => {
  const manual = ["price", "phone", "wechat", "qq", "otherContact", "address"] as const;
  const source = manual.map((field) => '<div class="discarded" data-import-field="' + field + '">' + "不读取".repeat(4000) + '</div>'
    + '<div class="discarded" data-import-field="' + field + '">多个匹配</div>').join("");
  const fields = Object.fromEntries(manual.map((field) => [field, ".discarded"]));
  const result = parsePartnerDetail(labeledArticle([
    ["服务", "虚构服务"], ["价格", "丢弃".repeat(6000)], ["费用", "另一价格"],
    ["电话", "丢弃".repeat(6000)], ["手机", "另一个电话"], ["微信", "丢弃".repeat(6000)],
    ["微信号", "另一微信"], ["QQ", "丢弃".repeat(6000)], ["QQ号", "另一QQ"],
    ["地址", "丢弃".repeat(6000)], ["详细地址", "另一个地址"],
    ["其他联系方式", "丢弃".repeat(6000)], ["其他联系方式", "另一联系方式"],
  ], source), detailUrl, { ...rules, fields });
  assert.equal(result.fields.price, "");
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.wechat, "");
  assert.equal(result.fields.qq, null);
  assert.equal(result.fields.otherContact, null);
  assert.equal(result.fields.address, null);
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.courseNotes, null);
});

test("manual-only structured fields never turn their surrounding prose into a service", () => {
  for (const label of ["价格", "电话", "微信", "QQ", "其他联系方式"]) {
    const html = '<article><h1>虚构标题</h1><p>普通介绍</p>' + labeledRows([[label, "不应保存"]]) + '</article>';
    assert.throws(() => parsePartnerDetail(html, detailUrl, rules), { code: "DETAIL_MISSING_FIELDS" });
  }
});

test("manual colon-labeled lines cannot survive in broad explicit services or notes", () => {
  const html = '<article><h1>虚构标题</h1><div id="service">虚构服务<br>电话：source-phone<br>电话续行</div>'
    + '<div id="notes">指定说明<br>价格：source-price<br>价格续行</div></article>';
  const result = parsePartnerDetail(html, detailUrl, { ...rules, fields: { services: "#service", courseNotes: "#notes" } });
  assert.equal(result.fields.services, "虚构服务");
  assert.equal(result.fields.courseNotes, "指定说明");
  assert.doesNotMatch(JSON.stringify(result.fields), /source-phone|source-price|续行/);
});

test("declaration sections and oversized introductions keep fixed diagnostics and photos intact", () => {
  const declaration = '<section><h4>声明信息</h4><p>不应保存的声明</p></section>';
  const html = '<article><h1>虚构标题</h1><p>保留介绍</p>' + declaration
    + labeledRows([["服务", "虚构服务"]]) + '<img src="/synthetic-photo.jpg"></article>';
  const result = parsePartnerDetail(html, detailUrl, rules);
  assert.equal(result.fields.courseNotes, "保留介绍");
  assert.deepEqual(result.photoUrls, ["https://partner.example/synthetic-photo.jpg"]);
  const oversized = '<article><h1>虚构标题</h1><p>' + "介绍".repeat(5001) + '</p>'
    + labeledRows([["服务", "虚构服务"]]) + '</article>';
  assert.throws(() => parsePartnerDetail(oversized, detailUrl, rules), error => {
    assert.equal((error as { code?: string }).code, "DETAIL_LIMIT");
    assert.doesNotMatch(String(error), /介绍/);
    return true;
  });
});


test("legacy, marked and explicit service containers identify an introduction without a table", () => {
  for (const scenario of [
    { body: '<section><h2>服务内容</h2><p>虚构服务</p></section>', rules },
    { body: '<div data-import-field="services">虚构服务</div>', rules },
    { body: '<div id="selected-service">虚构服务</div>', rules: { ...rules, fields: { services: "#selected-service" } } },
  ]) {
    const html = '<article><h1>虚构标题</h1><p>标题下介绍</p>' + scenario.body + '</article>';
    const result = parsePartnerDetail(html, detailUrl, scenario.rules);
    assert.equal(result.fields.services, "虚构服务");
    assert.equal(result.fields.courseNotes, "标题下介绍");
  }
});

test("manual nested tables, definitions and pairs are removed from explicit, marked and legacy text", () => {
  const source = [
    labeledRows([["电话", "source-phone"], ["价格", "source-price"], ["微信", "source-wechat"]]),
    '<dl><dt>QQ</dt><dd>source-qq</dd><dt>其他联系方式</dt><dd>source-other</dd></dl>',
    '<div><span>电话</span><span>source-phone</span></div>',
    '<div data-import-field="phone">source-phone</div>',
  ].join("");
  for (const scenario of [
    { service: '<div id="service">虚构服务' + source + '</div>', notes: '<div id="notes">说明' + source + '</div>',
      rules: { ...rules, fields: { services: "#service", courseNotes: "#notes" } } },
    { service: '<div data-import-field="services">虚构服务' + source + '</div>',
      notes: '<div data-import-field="courseNotes">说明' + source + '</div>', rules },
    { service: '<section><h2>服务内容</h2>虚构服务' + source + '</section>',
      notes: '<section><h2>补充说明</h2>说明' + source + '</section>', rules },
  ]) {
    const result = parsePartnerDetail('<h1>虚构标题</h1>' + scenario.service + scenario.notes
      + '<img data-import-photo src="/synthetic-photo.jpg">', detailUrl, scenario.rules);
    assert.equal(result.fields.services, "虚构服务");
    assert.equal(result.fields.courseNotes, "说明");
    assert.deepEqual(result.photoUrls, ["https://partner.example/synthetic-photo.jpg"]);
    assert.doesNotMatch(JSON.stringify(result.fields), /source-|电话|价格|微信|QQ|其他联系方式/);
  }
});


test("red introduction text is retained regardless of styling classes", () => {
  const html = '<article><h1>虚构标题</h1><p class="text-rose-500" style="color:red">红色介绍文字</p>'
    + labeledRows([["服务", "虚构服务"]]) + '</article>';
  assert.equal(parsePartnerDetail(html, detailUrl, rules).fields.courseNotes, "红色介绍文字");
});

test("manual label pairs preserve surrounding raw service and introduction text", () => {
  const mixed = '需要保留的服务正文<span>电话</span><span>source-phone</span>';
  for (const scenario of [
    { body: '<div data-import-field="services">' + mixed + '</div>', rules },
    { body: '<div id="selected-services">' + mixed + '</div>', rules: { ...rules, fields: { services: "#selected-services" } } },
    { body: '<section><h2>服务内容</h2><div>' + mixed + '</div></section>', rules },
  ]) {
    const result = parsePartnerDetail('<h1>虚构标题</h1>' + scenario.body, detailUrl, scenario.rules);
    assert.equal(result.fields.services, "需要保留的服务正文");
    assert.equal(result.fields.phone, "");
  }
  const intro = '<article><h1>虚构标题</h1><div>保留原始介绍<span>电话</span><span>source-phone</span></div>'
    + labeledRows([["服务", "虚构服务"]]) + '</article>';
  assert.equal(parsePartnerDetail(intro, detailUrl, rules).fields.courseNotes, "保留原始介绍");
});
