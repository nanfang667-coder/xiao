import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { summarizePartnerListStructure } from "./partner-list-diagnostics.ts";

const pageUrl = "https://partner.example/list?city_id=110000";
const script = (json: string) => '<script id="__NUXT_DATA__" type="application/json">' + json + '</script>';

test("counts anchor shapes, safe resolved show links and click attributes without returning their values", () => {
  const html = '<a href="/show?uuid=private-one"><h2>Private title</h2><img src="/private.jpg"></a>'
    + '<h3><a href="/show?city_id=110000&amp;uuid=private-two">Private body</a></h3>'
    + '<a href="show?uuid=private-three"><h4>Private title</h4></a>'
    + '<a onclick="privateClick()">No href</a><div data-href="/private" data-to="/private" to="/private"></div>'
    + '<a href="https://foreign.example/show?uuid=private-four">Other source</a>'
    + '<a href="javascript:alert(\'/show?uuid=private-five\')">Unsafe</a>';
  const summary = summarizePartnerListStructure(html, pageUrl);
  assert.equal(summary.status, "ok");
  assert.equal(summary.pageUrlValid, true);
  assert.equal(summary.anchorsWithHref, 5);
  assert.equal(summary.anchorsWithoutHref, 1);
  assert.equal(summary.exactConfiguredShapeCount, 3);
  assert.equal(summary.resolvedShowUuidLinks, 3);
  assert.equal(summary.onclickCount, 1);
  assert.equal(summary.dataHrefCount, 1);
  assert.equal(summary.dataToCount, 1);
  assert.equal(summary.toAttributeCount, 1);
  assert.equal(summary.headingLinks, 1);
  assert.equal(summary.wrappedHeadings, 2);
  assert.equal(summary.wrappedHeadingLinks, 2);
  assert.equal(summary.imageElementCount, 1);
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("safe resolution rejects off-site, credentialed, fragmented, non-HTTPS and malformed show links", () => {
  const hrefs = [
    "https://foreign.example/show?uuid=SENTINEL", "http://partner.example/show?uuid=SENTINEL",
    "https://user:SENTINEL@partner.example/show?uuid=x", "https://@partner.example/show?uuid=x",
    "/show?uuid=SENTINEL#private", "/show?uuid=SENTINEL\\private", "/show?uuid=", "/show?city_id=1",
    "https://partner.example:444/show?uuid=x", "/show-other?uuid=x",
  ];
  const html = hrefs.map(href => '<a href="' + href + '">Private text</a>').join("");
  assert.equal(summarizePartnerListStructure(html, pageUrl).resolvedShowUuidLinks, 0);
  assert.equal(summarizePartnerListStructure(html, "file:///SENTINEL").pageUrlValid, false);
});

test("only fixed allowed JSON keys contribute counts; scripts are parsed as inert data", () => {
  const payload = [{ list: 1, total: 3, page: 1, pageSize: 20, city_id: "private" },
    { items: 2, records: 3, id: "private", uuid: "private", imageList: 4, arbitraryPrivateKey: "private" }];
  const summary = summarizePartnerListStructure(script(JSON.stringify(payload))
    + '<script src="/private-runtime.js">throw new Error("must not execute")</script>', pageUrl);
  assert.equal(summary.scriptCount, 2);
  assert.equal(summary.externalScriptCount, 1);
  assert.equal(summary.nuxtPayloadCount, 1);
  assert.equal(summary.nuxtParseable, true);
  assert.equal(summary.nuxtFlatNodeCount, 2);
  assert.deepEqual(summary.nuxtKeyOccurrences, {
    uuid: 1, id: 1, list: 1, items: 1, records: 1, imageList: 1, total: 1, page: 1, pageSize: 1, city_id: 1,
  });
  assert.equal(summary.nuxtVisitLimitReached, false);
});

test("the complete result is a fixed count/flag/enum schema and never includes sensitive sentinels", () => {
  const sentinel = "SYNTHETIC_SECRET_SENTINEL_7c0a7fe4";
  const payload = [{ [sentinel]: sentinel, uuid: sentinel, list: [{ id: sentinel, imageList: [sentinel] }] }];
  const html = '<html data-private="' + sentinel + '"><title>' + sentinel + '</title><body>' + sentinel
    + '<a href="/show?uuid=' + sentinel + '" onclick="' + sentinel + '"><h3>' + sentinel + '</h3></a>'
    + '<img src="https://' + sentinel + '.example/' + sentinel + '.jpg" alt="' + sentinel + '">'
    + script(JSON.stringify(payload)) + '<script src="/' + sentinel + '.js">' + sentinel + '</script></body></html>';
  const baseline = summarizePartnerListStructure("", pageUrl);
  const summary = summarizePartnerListStructure(html, 'https://partner.example/' + sentinel);
  assert.deepEqual(Object.keys(summary).sort(), Object.keys(baseline).sort());
  assert.deepEqual(Object.keys(summary.nuxtKeyOccurrences).sort(), Object.keys(baseline.nuxtKeyOccurrences).sort());
  for (const [key, value] of Object.entries(summary)) {
    if (key === "status") {
      assert.equal(typeof value, "string");
      assert.ok(["ok", "invalid_input", "too_large", "parse_failed"].includes(String(value)));
    }
    else if (key === "nuxtKeyOccurrences") assert.ok(Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0));
    else assert.ok(typeof value === "boolean" || typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  }
  const serialized = JSON.stringify(summary);
  for (const privateValue of [sentinel, "https://", "partner.example", "data-private", "arbitraryPrivateKey", ".jpg"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("malformed and incorrectly typed Nuxt payloads expose flags rather than exceptions or payload excerpts", () => {
  const sentinel = "SYNTHETIC_SECRET_PARSE_ERROR";
  for (const html of [script('{"private":"' + sentinel), '<script id="__NUXT_DATA__" type="text/javascript">' + sentinel + '</script>']) {
    const summary = summarizePartnerListStructure(html, pageUrl);
    assert.equal(summary.status, "ok");
    assert.equal(summary.nuxtParseable, false);
    assert.equal(JSON.stringify(summary).includes(sentinel), false);
  }
});

test("HTML and cumulative JSON byte limits prevent unbounded parsing", () => {
  const html = "虚".repeat(666_667);
  assert.equal(summarizePartnerListStructure(html, pageUrl).status, "too_large");
  assert.equal(summarizePartnerListStructure(html, pageUrl).htmlBytes, 2_000_001);
  const summary = summarizePartnerListStructure(script(JSON.stringify("x".repeat(1_500_000))), pageUrl);
  assert.equal(summary.status, "ok");
  assert.equal(summary.nuxtJsonLimitReached, true);
  assert.equal(summary.nuxtParseable, false);
  assert.equal(summary.nuxtVisitedCount, 0);
});

test("Nuxt traversal stays bounded for wide and deep inert JSON", () => {
  const wide = summarizePartnerListStructure(script(JSON.stringify(Array(45_000).fill({ id: "private" }))), pageUrl);
  assert.equal(wide.nuxtParseable, true);
  assert.equal(wide.nuxtVisitLimitReached, true);
  assert.ok(wide.nuxtVisitedCount <= 40_000);
  let deep: unknown = { id: "private" };
  for (let n = 0; n < 50; n++) deep = { list: deep };
  const summary = summarizePartnerListStructure(script(JSON.stringify(deep)), pageUrl);
  assert.equal(summary.nuxtDepthLimitReached, true);
  assert.ok(summary.nuxtVisitedCount <= 40_000);
});

test("known challenge and login indicators are booleans without marker values", () => {
  const summary = summarizePartnerListStructure('<script src="/cdn-cgi/challenge-platform/private.js"></script>'
    + '<div data-sitekey="PRIVATE_CAPTCHA_KEY"></div><form action="/login?token=PRIVATE"><input type="password" value="PRIVATE_PASSWORD"></form>', pageUrl);
  assert.equal(summary.cloudflareMarker, true);
  assert.equal(summary.captchaMarker, true);
  assert.equal(summary.loginMarker, true);
  assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
  assert.equal(summarizePartnerListStructure('<a href="/login">Login navigation</a>', pageUrl).loginMarker, false);
});
