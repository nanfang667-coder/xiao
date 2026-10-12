import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const origin = "https://partner.example";
const imageOrigin = "https://images.example";
const listUrl = origin + "/?page=2";
const secret = "SYNTHETIC_PRIVATE_DATA";

function form(values = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ sourceId: "1", listUrl, ...values })) {
    for (const item of Array.isArray(value) ? value : [value]) result.append(key, item);
  }
  return result;
}

function fixture(options = {}) {
  let source = { id: 1, origin, rules: '{"custom":"kept"}', imageOrigins: "[]", ...options.source };
  const calls = [];
  const changed = [];
  let conflicts = options.conflicts ?? 0;
  class PartnerImportError extends Error {}
  const mocks = {
    "server-only": {},
    "./partner-import": { PartnerImportError },
    "./prisma": { prisma: { partnerImportSource: {
      findUnique: async query => { calls.push(["find", query]); return options.missing ? null : { ...source }; },
      updateMany: async query => {
        calls.push(["update", query]);
        if (conflicts-- > 0) {
          source.imageOrigins = JSON.stringify(["https://concurrent.example"]);
          return { count: 0 };
        }
        changed.push(query.data);
        Object.assign(source, query.data);
        return { count: 1 };
      },
    } } },
    "./partner-import-fetch": { fetchPartnerResource: async (url, allowed, settings) => {
      calls.push(["fetch", url, allowed, settings]);
      if (options.fetchFail || options.failDetails && url !== listUrl) throw new Error(secret);
      return { bytes: Buffer.from(url === listUrl ? "synthetic-list" : "synthetic-detail"), contentType: "text/html; charset=utf-8", url };
    } },
    "./partner-import-parser": {
      normalizePartnerImportRules: input => { calls.push(["rules", input]); if (options.badRules) throw new Error(secret); return input; },
      parsePartnerListing: () => options.links ?? Array.from({ length: 5 }, (_, n) => origin + "/post/" + n),
      parsePartnerDetail: (_html, url) => {
        calls.push(["detail", url]);
        if (options.failFirst && url.endsWith("/0")) throw new Error(secret);
        return { fields: { name: secret }, photoUrls: options.photos ?? [imageOrigin + "/photo?token=private"] };
      },
    },
    "./partner-import-errors": {
      isPartnerImportDiagnosticCode: code => ["INVALID_RULES", "LISTING_NO_MATCH"].includes(code),
      getPartnerImportErrorMessage: code => "SAFE_" + code,
    },
  };
  const sourceText = fs.readFileSync(new URL("../src/lib/partner-import-origins.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, URL, Buffer, TextDecoder,
    require(name) { assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name); return mocks[name]; },
  });
  return { api: exports, calls, changed, source: () => source };
}

test("detection reads only three details using the same source rules and origin, returns domains only", async () => {
  const f = fixture();
  const result = JSON.parse(JSON.stringify(await f.api.detectImportImageOrigins(form())));
  assert.deepEqual(result, { sourceId: 1, listUrl, origins: [imageOrigin], sampled: 3, failed: 0, photoCount: 3 });
  const fetched = f.calls.filter(([kind]) => kind === "fetch");
  assert.equal(fetched.length, 4);
  assert.ok(fetched.every(([, url, allowed, settings]) => url.startsWith(origin) && allowed.length === 1 && allowed[0] === origin && settings.accept === "html"));
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(([kind]) => kind === "rules")[1])), { custom: "kept" });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
  assert.equal(f.changed.length, 0);
});

test("detection filters configured and same-origin domains, deduplicates new origins", async () => {
  const f = fixture({ source: { imageOrigins: '["https://known.example"]' }, photos: [origin + "/photo", "https://known.example/a", imageOrigin + "/a", imageOrigin + "/b"] });
  const result = await f.api.detectImportImageOrigins(form());
  assert.deepEqual(Array.from(result.origins), [imageOrigin]);
  assert.equal(result.photoCount, 12);
});

test("detection reports partial sampling failures without exposing exception contents", async () => {
  const f = fixture({ failFirst: true });
  const result = await f.api.detectImportImageOrigins(form());
  assert.equal(result.sampled, 2);
  assert.equal(result.failed, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(f.changed.length, 0);
});

test("zero detected images are distinguished from already allowed images", async () => {
  const f = fixture({ photos: [] });
  const result = await f.api.detectImportImageOrigins(form());
  assert.equal(result.photoCount, 0);
  assert.equal(result.origins.length, 0);
});

test("invalid selection and off-origin list cannot initiate a fetch", async () => {
  for (const values of [{ sourceId: "0" }, { listUrl: "https://other.example/posts" }, { listUrl: "http://partner.example/" }, { listUrl: "https://@partner.example/" }, { listUrl: listUrl + "#fragment" }]) {
    const f = fixture();
    await assert.rejects(f.api.detectImportImageOrigins(form(values)));
    assert.equal(f.calls.some(([kind]) => kind === "fetch"), false);
    assert.equal(f.changed.length, 0);
  }
});

test("invalid source rules, absent source, empty listing, failed network and failed details have safe failures", async () => {
  for (const options of [{ missing: true }, { badRules: true }, { links: [] }, { fetchFail: true }, { failDetails: true }]) {
    const f = fixture(options);
    await assert.rejects(f.api.detectImportImageOrigins(form()), error => !error.message.includes(secret));
    assert.equal(f.changed.length, 0);
  }
});

test("detection refuses a union exceeding ten image origins", async () => {
  const f = fixture({ source: { imageOrigins: JSON.stringify(Array.from({ length: 10 }, (_, n) => "https://images" + n + ".example")) } });
  await assert.rejects(f.api.detectImportImageOrigins(form()), /10/);
  assert.equal(f.changed.length, 0);
});

test("explicit save merges allowed domains and writes only imageOrigins, never fetches", async () => {
  const f = fixture({ source: { imageOrigins: '["https://known.example"]' } });
  const result = await f.api.addImportImageOrigins(form({ allowImageOrigins: "yes", imageOrigin: [imageOrigin, imageOrigin] }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { sourceId: 1, listUrl });
  assert.deepEqual(JSON.parse(f.source().imageOrigins), ["https://known.example", imageOrigin]);
  assert.equal(f.source().rules, '{"custom":"kept"}');
  assert.deepEqual(Object.keys(f.changed[0]), ["imageOrigins"]);
  assert.equal(f.calls.some(([kind]) => kind === "fetch"), false);
});

test("save requires explicit confirmation and validates all origin inputs before writing", async () => {
  for (const values of [
    { imageOrigin },
    { allowImageOrigins: "yes", imageOrigin: "http://images.example" },
    { allowImageOrigins: "yes", imageOrigin: imageOrigin + "/path" },
    { allowImageOrigins: "yes", imageOrigin: imageOrigin + "/?secret=1" },
    { allowImageOrigins: "yes", imageOrigin: "https://user:pass@images.example" },
    { allowImageOrigins: "yes", imageOrigin: "https://@images.example" },
    { allowImageOrigins: "yes", imageOrigin: imageOrigin + ":8080" },
    { allowImageOrigins: "yes", imageOrigin, listUrl: "https://other.example/" },
  ]) {
    const f = fixture();
    await assert.rejects(f.api.addImportImageOrigins(form(values)));
    assert.equal(f.changed.length, 0);
    assert.equal(f.calls.some(([kind]) => kind === "fetch"), false);
  }
});

test("save retries an optimistic conflict and preserves concurrent domains", async () => {
  const f = fixture({ conflicts: 1 });
  await f.api.addImportImageOrigins(form({ allowImageOrigins: "yes", imageOrigin }));
  assert.deepEqual(JSON.parse(f.source().imageOrigins), ["https://concurrent.example", imageOrigin]);
  assert.equal(f.calls.filter(([kind]) => kind === "update").length, 2);
});

test("persistent save conflicts fail without overwriting another update", async () => {
  const f = fixture({ conflicts: 3 });
  await assert.rejects(f.api.addImportImageOrigins(form({ allowImageOrigins: "yes", imageOrigin })), /同时发生/);
  assert.equal(f.changed.length, 0);
  assert.equal(f.calls.filter(([kind]) => kind === "update").length, 3);
});

test("save applies maximum to merged domains and rejects corrupted stored configuration", async () => {
  for (const imageOrigins of ["{}", JSON.stringify(Array.from({ length: 10 }, (_, n) => "https://images" + n + ".example"))]) {
    const f = fixture({ source: { imageOrigins } });
    await assert.rejects(f.api.addImportImageOrigins(form({ allowImageOrigins: "yes", imageOrigin })));
    assert.equal(f.changed.length, 0);
  }
});
