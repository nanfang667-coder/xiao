import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner needs the explicit .ts extension.
import { Partner66fengError, parsePartner66fengImages, partner66fengRequest } from "./partner-66feng-images.ts";

const PAGE = "https://66feng.com/list?city_id=110000";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_UUID = "11111111-2222-4333-8444-555555555555";
const SECRET = "SYNTHETIC_PRIVATE_POST_TEXT";
const item = (overrides: Record<string, unknown> = {}) => ({ uuid: UUID, images: { cover: "", images: [] }, ...overrides });
const payload = (data: unknown[] = [item()], overrides: Record<string, unknown> = {}) => JSON.stringify({ code: 123, data,
  total: data.length, page: 1, page_size: 20, ...overrides });
const parse = (data: unknown[] = [item()], overrides: Record<string, unknown> = {}, page = PAGE) => parsePartner66fengImages(payload(data, overrides), page);

test("fixed origin request planning defaults filters and canonicalizes page URL", () => {
  const plan = partner66fengRequest(PAGE);
  assert.deepEqual(plan, { apiUrl: "https://66feng.com/api/base/public/post/list", jsonBody: { page: 1, city_id: "110000", post_type: [0] },
    pageUrl: "https://66feng.com/list?city_id=110000&page=1&post_type=0" });
  assert.deepEqual(partner66fengRequest("https://66feng.com:443/list?post_type=2,3,2&page=10&city_id=310000")?.jsonBody,
    { page: 10, city_id: "310000", post_type: [2, 3] });
  assert.deepEqual(partner66fengRequest(PAGE + "&post_type=0,100")?.jsonBody.post_type, [0, 100]);
  assert.equal(partner66fengRequest("https://other.example/list?city_id=110000"), null);
});

test("request planner rejects unsafe paths, ambiguous keys and invalid city/page/type filters", () => {
  for (const url of ["https://66feng.com/show?city_id=110000", PAGE + "#", PAGE + "&unknown=1", PAGE + "&page=1&page=2",
    PAGE + "&city_id=110000", "https://66feng.com/list", PAGE.replace("110000", "11000"), PAGE + "&page=0", PAGE + "&page=10001",
    PAGE + "&page=01", PAGE + "&post_type=", PAGE + "&post_type=-1", PAGE + "&post_type=101", PAGE + "&post_type=01",
    PAGE + "&post_type=" + Array(13).fill(1).join(","), "https://@66feng.com/list?city_id=110000", "https://u:p@66feng.com/list?city_id=110000",
    "https:66feng.com/list?city_id=110000", PAGE + " ", "https://66feng.com\\list?city_id=110000", "https://66feng.com:444/list?city_id=110000",
    "http://66feng.com/list?city_id=110000"]) {
    assert.throws(() => partner66fengRequest(url), { code: "INVALID_SOURCE" });
  }
});

test("pagination preserves city and type filters, matches response page and detects the final page", () => {
  const first = parse([item()], { total: 41, page_size: 20 }, PAGE + "&post_type=2,3");
  assert.equal(first.nextPageUrl, "https://66feng.com/list?city_id=110000&page=2&post_type=2%2C3");
  const last = parse([item()], { total: 41, page: 3, page_size: 20 }, PAGE + "&page=3");
  assert.equal(last.nextPageUrl, null);
  assert.equal(parse([], { total: 0 }).nextPageUrl, null);
  for (const override of [{ page: 2 }, { total: 0 }, { total: 10_000_001 }, { page_size: 0 }, { page_size: 51 },
    { total: 1.5 }, { page: "1" }, { code: "200" }, { code: null }]) assert.throws(() => parse([item()], override), { code: "INVALID_RESPONSE" });
  assert.throws(() => parse([], { total: 30, page_size: 20 }), { code: "INVALID_RESPONSE" });
  assert.throws(() => parse([item()], { total: 19, page: 2, page_size: 20 }, PAGE + "&page=2"), { code: "INVALID_RESPONSE" });
  assert.throws(() => parse([item(), item({ uuid: OTHER_UUID })], { total: 2, page_size: 1 }), { code: "INVALID_RESPONSE" });
});

test("explicit image arrays win over cover and relative images become absolute without approving media origins", () => {
  const result = parse([item({ images: { cover: "https://ignored.example/cover.jpg", images: ["/uploads/one.jpg", "https://cdn.example/two.jpg"] } })]);
  const detail = `https://66feng.com/show?uuid=${UUID}`;
  assert.deepEqual(result.urls, [detail]);
  assert.deepEqual(result.photoHints[detail], ["https://66feng.com/uploads/one.jpg", "https://cdn.example/two.jpg"]);
  assert.deepEqual(parse([item({ images: { cover: "/cover.jpg", images: [] } })]).photoHints[detail], ["https://66feng.com/cover.jpg"]);
  const empty = parse();
  assert.equal(Object.hasOwn(empty.photoHints, detail), true);
  assert.deepEqual(empty.photoHints[detail], []);
});

test("UUIDs canonicalize and duplicates require exactly the same normalized image hints", () => {
  const first = item({ uuid: UUID.toUpperCase(), images: { cover: "", images: ["/one.jpg", "/one.jpg"] } });
  const same = item({ images: { cover: "", images: ["https://66feng.com/one.jpg"] } });
  assert.equal(parse([first, same]).urls.length, 1);
  assert.throws(() => parse([first, item()]), { code: "INVALID_RESPONSE" });
  for (const uuid of ["", "../secret", "not-a-uuid", UUID + "x"]) assert.throws(() => parse([item({ uuid })]), { code: "INVALID_RESPONSE" });
});

test("wrong response and image shapes fail with fixed errors and never accept nine images", () => {
  for (const entry of [null, [], item({ images: null }), item({ images: [] }), item({ images: { cover: null, images: [] } }),
    item({ images: { cover: "", images: null } }), item({ images: { cover: "", images: [1] } })]) {
    assert.throws(() => parse([entry]), { code: "INVALID_RESPONSE" });
  }
  assert.throws(() => parse([item({ images: { cover: "", images: Array(9).fill("/one.jpg") } })]), { code: "DETAIL_LIMIT" });
  assert.throws(() => parse(Array(51).fill(item()), { total: 51 }), { code: "INVALID_RESPONSE" });
  assert.equal(parse([item({ images: { cover: "", images: Array.from({ length: 8 }, (_, i) => `/${i}.jpg`) } })]).urls.length, 1);
});

test("unsafe media URLs, credentials, hashes, local hosts and IP literals are rejected", () => {
  for (const image of ["", "data:image/png;base64,AAAA", "blob:https://66feng.com/private", "http://cdn.example/image.jpg", "//cdn.example/image.jpg",
    "relative.jpg", "https://u:p@cdn.example/image.jpg", "https://@cdn.example/image.jpg", "https://cdn.example:444/image.jpg",
    "https://cdn.example/image.jpg#", "https://localhost/image.jpg", "https://img.local/image.jpg", "https://127.0.0.1/image.jpg",
    "https://10.0.0.1/image.jpg", "https://[::1]/image.jpg", "https://2130706433/image.jpg", "https://cdn.example/a b.jpg", "/a\\b.jpg",
    "https://cdn.example/" + "a".repeat(4096)]) {
    assert.throws(() => parse([item({ images: { cover: "", images: [image] } })]), { code: "UNSAFE_IMAGE" });
  }
});

test("post text, response scalar values and native JSON errors never leave the pure result/error", () => {
  const result = parse([item({ title: SECRET, body: SECRET, content: SECRET })], { msg: SECRET, code: 999 });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(Object.hasOwn(result, "code"), false);
  for (const text of [`{"title":"${SECRET}"`, JSON.stringify({ code: 1, data: SECRET }), "x".repeat(1_500_001), JSON.stringify([SECRET])]) {
    assert.throws(() => parsePartner66fengImages(text, PAGE), error => error instanceof Partner66fengError
      && error.code === "INVALID_RESPONSE" && !error.message.includes(SECRET));
  }
  assert.throws(() => parsePartner66fengImages(payload(), "https://other.example/list"), { code: "INVALID_SOURCE" });
});
