import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { extractBoundNuxtImageUrls, PartnerNuxtImagesError } from "./partner-import-nuxt-images.ts";

const detailUrl = "https://partner.example/information/123";
const articleTitle = "虚构帖子标题";

function record(images = 3): Record<string, unknown> {
  return {
    id: 123, title: articleTitle, content: "<p>虚构正文</p>",
    imageList: Array.from({ length: images }, (_, index) => ({ url: "https://media.example/asset/" + index })),
  };
}

// A synthetic serializer for the small devalue subset used in these fixtures.
// It does not use a website, database, filesystem or actual post content.
function flatPayload(value: unknown, wrappers: string[] = []): unknown[] {
  const flat: unknown[] = [];
  const seen = new Map<unknown, number>();
  function add(entry: unknown): number {
    if (entry === undefined) return -1;
    if (seen.has(entry)) return seen.get(entry)!;
    const index = flat.length;
    seen.set(entry, index);
    flat.push(null);
    if (Array.isArray(entry)) flat[index] = entry.map(add);
    else if (entry && typeof entry === "object") {
      const result: Record<string, number> = Object.create(null);
      for (const [key, child] of Object.entries(entry)) result[key] = add(child);
      flat[index] = result;
    } else flat[index] = entry;
    return index;
  }
  add(value);
  for (const wrapper of wrappers) {
    const originalIndex = flat.length;
    flat.push(flat[0]);
    flat[0] = [wrapper, originalIndex];
  }
  return flat;
}

function script(flat: unknown): string {
  return '<script id="__NUXT_DATA__" type="application/json">'
    + JSON.stringify(flat).replace(/</g, "\\u003c") + "</script>";
}

function extract(value: unknown, wrappers: string[] = []): string[] | null {
  return extractBoundNuxtImageUrls({ html: script(flatPayload(value, wrappers)), detailUrl, articleTitle });
}

test("confirmed own id/title/content/imageList.url records extract 3, 3, and 4 extensionless HTTPS originals", () => {
  for (const count of [3, 3, 4]) {
    assert.deepEqual(extract({ data: { post: record(count) } }), Array.from({ length: count }, (_, index) => "https://media.example/asset/" + index));
  }
});

test("only the four static reactive wrappers are resolved", () => {
  for (const wrapper of ["Reactive", "ShallowReactive", "Ref", "ShallowRef"]) {
    assert.equal(extract({ data: record() }, [wrapper])?.length, 3);
  }
  assert.equal(extract({ data: record() }, ["Reactive", "Ref", "ShallowReactive", "ShallowRef"])?.length, 3);
  assert.deepEqual(extract(record(), ["UnknownConstructor"]), null);
});

test("both own id and normalized own title must match the current article", () => {
  assert.deepEqual(extract({ ...record(), id: 999 }), null);
  assert.deepEqual(extract({ ...record(), title: "另一篇标题" }), null);
  assert.deepEqual(extract({ ...record(), id: undefined, url: detailUrl, canonical: detailUrl }), null);
  assert.deepEqual(extract({ ...record(), title: undefined, name: articleTitle }), null);
  assert.deepEqual(extract({ ...record(), content: undefined }), null);
  assert.deepEqual(extractBoundNuxtImageUrls({
    html: script(flatPayload({ ...record(), id: "123", title: "<b>虚构帖子标题</b>" })),
    detailUrl: detailUrl + ".html", articleTitle: " \n虚构帖子标题\t ",
  }), ["https://media.example/asset/0", "https://media.example/asset/1", "https://media.example/asset/2"]);
});

test("unrelated posts and unrelated image strings are never imported", () => {
  const result = extract({
    data: [record(), { ...record(), id: 124, imageList: [{ url: "https://wrong.example/other" }] }],
    avatar: "https://wrong.example/avatar.jpg",
    banner: { url: "https://wrong.example/banner.jpg" },
    images: ["https://wrong.example/loose.jpg"],
  });
  assert.deepEqual(result, ["https://media.example/asset/0", "https://media.example/asset/1", "https://media.example/asset/2"]);
});

test("author, user, comments, related, recommendations, ads, site, config and seo subtrees are excluded before decoding", () => {
  for (const key of ["author", "user", "comments", "related", "recommendations", "ads", "site", "config", "seo",
    "Author_Info", "USER-PROFILE", "relatedPosts", "siteConfig", "__proto__", "constructor", "prototype"]) {
    const root: Record<string, unknown> = Object.create(null);
    root[key] = record();
    assert.deepEqual(extract(root), null);
    assert.deepEqual(extractBoundNuxtImageUrls({
      html: script([{ [key]: "not-a-reference" }]), detailUrl, articleTitle,
    }), null);
  }
});

test("multiple distinct matching post records are ambiguous but shared references and ordinary cycles are safe", () => {
  assert.throws(() => extract({ one: record(), two: record() }), { code: "DETAIL_AMBIGUOUS_FIELDS" });
  const shared = record();
  assert.equal(extract({ one: shared, two: shared })?.length, 3);
  const cyclic: Record<string, unknown> = { post: record() };
  cyclic.self = cyclic;
  assert.equal(extract(cyclic)?.length, 3);
});

test("only own object url items are accepted, never string lists, src aliases or nested author URLs", () => {
  for (const imageList of [
    ["https://media.example/asset/0"],
    [{ src: "https://media.example/asset/0" }],
    [{ originalUrl: "https://media.example/asset/0" }],
    [{ author: { url: "https://media.example/asset/0" } }],
    [null], [undefined],
  ]) {
    assert.throws(() => extract({ ...record(), imageList }), { code: "INVALID_RESPONSE" });
  }
  assert.throws(() => extract({ ...record(), imageList: "https://media.example/asset/0" }), { code: "INVALID_RESPONSE" });
});

test("HTTPS media URLs may be external and signed but must not carry credentials or unsafe protocols", () => {
  const valid = { ...record(), imageList: [{ url: "https://cdn.example/picture?token=synthetic#preview" }] };
  assert.deepEqual(extract(valid), ["https://cdn.example/picture?token=synthetic"]);
  for (const url of ["http://cdn.example/image", "/relative/image", "javascript:alert(1)", "file:///image",
    "data:image/png;base64,AA", "https://user:password@cdn.example/image", "", "x".repeat(2049)]) {
    assert.throws(() => extract({ ...record(), imageList: [{ url }] }), { code: "INVALID_URL" });
  }
});

test("images are deduplicated and a list above eight entries fails instead of truncating", () => {
  assert.deepEqual(extract({ ...record(), imageList: [{ url: "https://cdn.example/one" }, { url: "https://cdn.example/one#same" }] }), [
    "https://cdn.example/one",
  ]);
  assert.equal(extract(record(8))?.length, 8);
  assert.throws(() => extract(record(9)), { code: "DETAIL_LIMIT" });
});

test("only one eligible inert Nuxt JSON script is considered", () => {
  const valid = script(flatPayload(record()));
  assert.deepEqual(extractBoundNuxtImageUrls({ html: '<script type="application/json">[]</script>', detailUrl, articleTitle }), null);
  assert.deepEqual(extractBoundNuxtImageUrls({ html: "<aside>" + valid + "</aside>", detailUrl, articleTitle }), null);
  assert.throws(() => extractBoundNuxtImageUrls({ html: valid + valid, detailUrl, articleTitle }), { code: "DETAIL_AMBIGUOUS_FIELDS" });
  assert.throws(() => extractBoundNuxtImageUrls({ html: valid.replace("application/json", "text/javascript"), detailUrl, articleTitle }), { code: "INVALID_RESPONSE" });
});

test("malformed JSON, invalid references and malformed or cyclic supported wrappers fail with fixed errors", () => {
  for (const flat of [{ post: 1 }, [], [{ data: 99 }], [{ data: "inline-not-reference" }],
    [["Reactive", 0]], [["Reactive", 1, 2], null], [["Reactive", "unsafe"]]]) {
    assert.throws(() => extractBoundNuxtImageUrls({ html: script(flat), detailUrl, articleTitle }), { code: "INVALID_RESPONSE" });
  }
  assert.throws(() => extractBoundNuxtImageUrls({
    html: '<script id="__NUXT_DATA__" type="application/json">{"private":"synthetic-secret"</script>',
    detailUrl, articleTitle,
  }), (error: unknown) => {
    assert.ok(error instanceof PartnerNuxtImagesError);
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.equal(String(error).includes("synthetic-secret"), false);
    return true;
  });
});

test("title and detail URL validation never accepts empty or unbound context", () => {
  assert.throws(() => extractBoundNuxtImageUrls({ html: script(flatPayload(record())), detailUrl, articleTitle: "" }), { code: "INVALID_RESPONSE" });
  for (const url of ["file:///123", "https://user:secret@partner.example/123", "https://partner.example/", "https://partner.example/%2F123"]) {
    assert.throws(() => extractBoundNuxtImageUrls({ html: script(flatPayload(record())), detailUrl: url, articleTitle }), { code: "INVALID_URL" });
  }
});

test("byte, flat-node, traversal-node and depth limits reject oversized payloads", () => {
  assert.throws(() => extractBoundNuxtImageUrls({ html: "中".repeat(700_000), detailUrl, articleTitle }), { code: "DETAIL_LIMIT" });
  assert.throws(() => extractBoundNuxtImageUrls({ html: script(["x".repeat(1_500_001)]), detailUrl, articleTitle }), { code: "DETAIL_LIMIT" });
  assert.throws(() => extractBoundNuxtImageUrls({ html: script(Array.from({ length: 20_001 }, () => null)), detailUrl, articleTitle }), { code: "DETAIL_LIMIT" });
  const nodeLimit: unknown[] = [Array.from({ length: 10_001 }, (_, index) => index + 1), ...Array.from({ length: 10_001 }, () => ({}))];
  assert.throws(() => extractBoundNuxtImageUrls({ html: script(nodeLimit), detailUrl, articleTitle }), { code: "DETAIL_LIMIT" });
  let nested: unknown = record();
  for (let depth = 0; depth < 35; depth++) nested = { nested };
  assert.throws(() => extract(nested), { code: "DETAIL_LIMIT" });
});

test("read budget limits repeated edges even when there are few distinct flat nodes", () => {
  const repeatedEdges: Record<string, number> = {};
  for (let index = 0; index < 40_001; index++) repeatedEdges["edge" + index] = 1;
  assert.throws(() => extractBoundNuxtImageUrls({
    html: script([repeatedEdges, "unused"]), detailUrl, articleTitle,
  }), { code: "DETAIL_LIMIT" });
});

test("a bound empty imageList is distinct from a payload that cannot be bound", () => {
  assert.deepEqual(extract(record(0)), []);
  assert.equal(extract({ ...record(0), id: "another-post" }), null);
  assert.equal(extractBoundNuxtImageUrls({ html: "<article></article>", detailUrl, articleTitle }), null);
});

test("image field wrapper depth stays relative to the bound record instead of resetting at extraction", () => {
  let post: unknown = record(1);
  for (let level = 0; level < 24; level++) post = { nested: post };
  const flat = flatPayload(post);
  const postNode = flat.find((value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, "imageList")) as Record<string, unknown>;
  let imageListReference = postNode.imageList;
  for (let level = 0; level < 8; level++) {
    flat.push(["Ref", imageListReference]);
    imageListReference = flat.length - 1;
  }
  postNode.imageList = imageListReference;
  assert.throws(() => extractBoundNuxtImageUrls({ html: script(flat), detailUrl, articleTitle }), { code: "DETAIL_LIMIT" });
});

test("ordinary pages without a Nuxt payload retain their existing query-route behavior", () => {
  assert.equal(extractBoundNuxtImageUrls({
    html: "<article><h1>虚构标题</h1><p>正文</p></article>",
    detailUrl: "https://partner.example/?id=123", articleTitle: "虚构标题",
  }), null);
});
