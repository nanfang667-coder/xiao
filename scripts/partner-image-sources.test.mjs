import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/partner-import-parser.ts";

function fixture({ existing } = {}) {
  const calls = [];
  const sources = {
    findUnique: async args => { calls.push(["read", args]); return existing ?? null; },
    create: async args => { calls.push(["create", args]); },
    update: async args => { calls.push(["update", args]); },
  };
  const mocks = {
    "server-only": {},
    "./prisma": { prisma: new Proxy({ partnerImportSource: sources }, {
      get(target, name) { assert.equal(name, "partnerImportSource"); return target[name]; },
    }) },
    "./partner-import-parser": parser,
  };
  const exports = {};
  const source = fs.readFileSync(new URL("../src/lib/partner-image-sources.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, URL, require(name) {
    assert.ok(Object.hasOwn(mocks, name), name); return mocks[name];
  } });
  return { api: exports, calls };
}

function form(values = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ name: " Synthetic source ", origin: "https://partner.example/", ...values })) result.set(key, value);
  return result;
}

test("source creation stores only normalized source configuration and deduplicated image origins", async () => {
  const f = fixture();
  await f.api.savePartnerImageSource(form({ imageOrigins: "https://images.example/\nhttps://images.example, https://cdn.example/" }));
  const data = f.calls.find(([operation]) => operation === "create")[1].data;
  assert.deepEqual(Object.keys(data).sort(), ["imageOrigins", "name", "origin", "rules"]);
  assert.equal(data.name, "Synthetic source");
  assert.equal(data.origin, "https://partner.example");
  assert.deepEqual(JSON.parse(data.imageOrigins), ["https://images.example", "https://cdn.example"]);
  assert.deepEqual(JSON.parse(data.rules), parser.DEFAULT_PARTNER_IMPORT_RULES);
});

test("editing preserves the existing origin and validates source IDs before any database call", async () => {
  const f = fixture({ existing: { id: 7, origin: "https://partner.example" } });
  await f.api.savePartnerImageSource(form({ sourceId: "7", rules: '{"photoSelector":"article img","nextPageSelector":"a.next"}' }));
  const update = f.calls.find(([operation]) => operation === "update")[1];
  assert.equal(update.where.id, 7);
  assert.equal(Object.hasOwn(update.data, "origin"), false);
  assert.equal(JSON.parse(update.data.rules).photoSelector, "article img");
  for (const sourceId of ["-1", "0", "1.5", "abc", "9007199254740992"]) {
    const invalid = fixture();
    await assert.rejects(invalid.api.savePartnerImageSource(form({ sourceId })), /无效的记录编号/);
    assert.equal(invalid.calls.length, 0);
  }
});

test("duplicate sources and editing to a different or missing origin never write", async () => {
  for (const [existing, values] of [
    [{ id: 7, origin: "https://partner.example" }, {}],
    [{ id: 7, origin: "https://other.example" }, { sourceId: "7" }],
    [null, { sourceId: "7" }],
  ]) {
    const f = fixture({ existing });
    await assert.rejects(f.api.savePartnerImageSource(form(values)));
    assert.equal(f.calls.some(([operation]) => operation === "create" || operation === "update"), false);
  }
});

test("invalid source, rules and image-origin configurations fail before database access", async () => {
  const cases = [
    { name: "" }, { name: "x".repeat(81) },
    ...["http://partner.example", "https://u:p@partner.example", "https://partner.example/path", "https://partner.example?x=1", "https://partner.example#x", "https://partner.example:444"].map(origin => ({ origin })),
    { rules: "not json" }, { rules: "[]" }, { rules: '{"photoSelector":"["}' }, { rules: "x".repeat(16001) },
    { imageOrigins: "https://images.example/path" }, { imageOrigins: "x".repeat(4097) },
    { imageOrigins: Array.from({ length: 11 }, (_, i) => `https://cdn${i}.example`).join("\n") },
  ];
  for (const values of cases) {
    const f = fixture();
    await assert.rejects(f.api.savePartnerImageSource(form(values)), f.api.PartnerSourceError);
    assert.equal(f.calls.length, 0);
  }
});
