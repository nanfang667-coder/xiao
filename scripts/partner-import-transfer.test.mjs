import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";

function load(file, mocks = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, Buffer, File, FormData, Request, Response, URL, TextEncoder, TextDecoder,
    Uint8Array, ReadableStream, Object, require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
      return mocks[name];
    } });
  return exports;
}
const cover = load("src/lib/partner-import-photo-cover.ts", { "./site-config.ts": { SITE_URL: "https://destination.example" } });
const format = load("src/lib/partner-import-transfer-format.ts", {
  "./teacher-post-input": load("src/lib/teacher-post-input.ts"),
  "./partner-import-declarations": load("src/lib/partner-import-declarations.ts"),
  "./partner-import-photo-cover": cover,
});
const client = load("src/lib/partner-import-transfer-client.ts");
const origin = "https://partner.example";
const record = () => ({ format: "partner-drafts-v1", kind: "post", origin, sourceUrl: origin + "/post/1",
  fields: { name: "Synthetic draft", services: "Synthetic service", address: "", phone: "" },
  cover: null, photos: [Buffer.from("synthetic photo bytes").toString("base64")] });
const file = (records) => new File([records.map(r => JSON.stringify(r)).join("\n")], "synthetic.jsonl");
const header = { format: "partner-drafts-v1", kind: "header", count: 1 };
const end = { ...header, kind: "end" };

test("parser allows contact-free pending drafts and drops publishing/ownership metadata", () => {
  const data = record();
  data.fields.status = "published";
  data.fields.assignedAccountId = 9;
  const result = format.parseTransferRecord(data, origin);
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.address, null);
  assert.equal(result.fields.status, undefined);
  assert.equal(result.fields.assignedAccountId, undefined);
  assert.equal(result.photos[0].toString(), "synthetic photo bytes");
});
test("parser preserves manually entered fields and photo cover", () => {
  const data = record();
  data.fields.phone = "123"; data.fields.address = "Synthetic manual address";
  data.cover = { text: "destination.example", position: "bottom", align: "center", widthPercent: 100, heightPercent: 15 };
  const result = format.parseTransferRecord(data, origin);
  assert.equal(result.fields.phone, "123");
  assert.equal(result.fields.address, data.fields.address);
  assert.equal(result.cover.heightPercent, 15);
});
test("parser rejects origin mismatches, URLs with credentials, malformed fields and photos", () => {
  for (const change of [
    { origin: "https://other.example" }, { sourceUrl: "https://other.example/1" },
    { sourceUrl: "https://user:pass@partner.example/1" }, { sourceUrl: origin + "/1#fragment" },
    { fields: { name: "n", services: [] } }, { photos: ["../private.jpg"] },
    { photos: Array(9).fill("YQ==") }, { photos: ["YR=="] },
    { photos: [Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")] },
    { photos: Array(3).fill(Buffer.alloc(5 * 1024 * 1024).toString("base64")) },
  ]) assert.throws(() => format.parseTransferRecord({ ...record(), ...change }, origin));
});
test("bounded body rejects oversized declared and streamed bodies", async () => {
  const req = (body, headers={}) => new Request("https://destination.example", { method: "POST", body,
    headers: { "content-type": "application/json", ...headers } });
  assert.equal((await format.readTransferBody(req(JSON.stringify(record())))).kind, "post");
  await assert.rejects(() => format.readTransferBody(req("{}", { "content-length": String(format.MAX_TRANSFER_LINE_BYTES + 1) })));
  await assert.rejects(() => format.readTransferBody(req(new Uint8Array(format.MAX_TRANSFER_LINE_BYTES + 1))));
  await assert.rejects(() => format.readTransferBody(req("broken")));
});
function storageFixture() {
  const rows = new Map(), saved = [], removed = [], calls = [];
  let fail = false, stale = false;
  const prisma = {
    partnerImportSource: { findUnique: async () => ({ id: 1, origin }) },
    partnerImportJob: { findUnique: async () => ({ sourceId: 1, source: { origin }, items: [{ draftId: 1 }] }) },
    partnerImportDraft: {
      findMany: async args => { assert.equal(args.where.status, "pending"); return [{ id: 1, version: 2 }]; },
      findFirst: async args => { assert.equal(args.where.version, 2); assert.equal(args.where.status, "pending");
        return stale ? null : { fields: JSON.stringify(record().fields), photos: '["synthetic.jpg"]', post: { sourceUrl: record().sourceUrl } }; },
    },
    $transaction: async work => work({
      partnerImportedPost: { upsert: async () => ({ id: 1, revision: 0 }) },
      partnerImportDraft: {
        findUnique: async args => rows.get(args.where.postId_contentHash.contentHash),
        create: async args => { if (fail) throw new Error("private failure"); calls.push(args.data);
          rows.set(args.data.contentHash, { id: rows.size + 1 }); return { id: rows.size }; },
      },
    }),
  };
  const impl = load("src/lib/partner-import-transfer.ts", {
    "server-only": {}, "node:crypto": { createHash }, "./prisma": { prisma },
    "./image-upload": { saveUploadedPhotos: async (files, dir) => {
      assert.equal(dir, "/synthetic-private"); saved.push(files.length); return files.map((_,i)=>"/uploads/synthetic-"+i+".jpg"); } },
    "./partner-import-photos": {
      partnerPrivateDirectory: () => "/synthetic-private",
      removePartnerPrivatePhotos: async keys => { removed.push(...keys); },
      parsePartnerPhotoKeys: JSON.parse, readPartnerPrivatePhoto: async () => Buffer.from("synthetic photo bytes"),
    },
    "./partner-import-photo-cover": cover, "./partner-import-transfer-format": format,
  });
  return { impl, rows, calls, saved, removed, setFail: () => { fail = true; }, setStale: () => { stale = true; } };
}
test("receiver deduplicates identical transfers, retains pending-only state and cleans duplicate files", async () => {
  const f = storageFixture();
  assert.equal(await f.impl.receiveTransferredDraft(1, record()), "imported");
  assert.equal(await f.impl.receiveTransferredDraft(1, record()), "skipped");
  assert.equal(f.rows.size, 1);
  assert.equal(f.calls[0].status, "pending");
  assert.equal(f.calls[0].baseRevision, 0);
  assert.equal(f.calls[0].assignedAccountId, undefined);
  assert.equal(f.removed.length, 1);
  const changed = record(); changed.fields.services += " changed";
  assert.equal(await f.impl.receiveTransferredDraft(1, changed), "imported");
  assert.equal(f.rows.size, 2);
});
test("receiver cleans private files after transaction failure", async () => {
  const f = storageFixture(); f.setFail();
  await assert.rejects(() => f.impl.receiveTransferredDraft(1, record()));
  assert.equal(f.removed.length, 1);
  assert.equal(f.rows.size, 0);
});
test("export creates bounded complete file and detects changed drafts without leaking errors", async () => {
  const f = storageFixture();
  const stream = await f.impl.exportTransferredJob("00000000-0000-0000-0000-000000000001");
  const lines = (await new Response(stream).text()).trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].kind, "header");
  assert.equal(lines[1].photos[0], record().photos[0]);
  assert.equal(lines[2].count, 1);
  f.setStale();
  await assert.rejects(async () => new Response(await f.impl.exportTransferredJob("00000000-0000-0000-0000-000000000001")).text(), /中转文件生成未完成/);
  await assert.rejects(() => f.impl.exportTransferredJob("../unsafe"));
});
test("client sends each record once and reports skipped transfers without viewing payloads", async () => {
  let calls = 0; const progress = [];
  const result = await client.uploadTransferFile(file([header, record(), end]), "2", c=>progress.push(c), async (url, options) => {
    calls++; assert.equal(url, "/adminzhangzhang/partner-import/transfer?sourceId=2");
    assert.equal(options.credentials, "same-origin"); assert.equal(JSON.parse(options.body).kind, "post");
    return Response.json({ status: "skipped" });
  });
  assert.equal(calls, 1); assert.equal(result.skipped, 1); assert.equal(progress.length, 2);
});
test("client detects truncation, extra records, HTTP failures and never displays response content", async () => {
  const ok = async () => Response.json({ status: "imported" });
  for (const records of [[header, record()], [header, record(), end, record()], [record()], [header, end]]) {
    await assert.rejects(() => client.uploadTransferFile(file(records), "1", ()=>{}, ok));
  }
  for (const status of [401, 403, 413, 500]) {
    await assert.rejects(() => client.uploadTransferFile(file([header, record(), end]), "1", ()=>{},
      async()=>new Response("PRIVATE SERVER BODY", { status })), e => e instanceof client.TransferFileError && !e.message.includes("PRIVATE"));
  }
});
function routeFixture(admin = true) {
  const calls = [];
  const route = load("src/app/adminzhangzhang/partner-import/transfer/route.ts", {
    "@/lib/auth": { isAdmin: async () => { calls.push("auth"); return admin; } },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/partner-import-transfer-format": { readTransferBody: async () => { calls.push("body"); return record(); } },
    "@/lib/partner-import-transfer": {
      receiveTransferredDraft: async () => { calls.push("receive"); return "imported"; },
      exportTransferredJob: async () => { calls.push("export"); return new ReadableStream({ start(c) { c.close(); } }); },
    },
  });
  return { route, calls };
}
test("route authenticates before reads and rejects cross-origin uploads", async () => {
  const url = "https://destination.example/adminzhangzhang/partner-import/transfer?sourceId=1";
  const anon = routeFixture(false);
  assert.equal((await anon.route.POST(new Request(url, { method: "POST" }))).status, 401);
  assert.equal((await anon.route.GET(new Request(url))).status, 401);
  assert.deepEqual(anon.calls, ["auth", "auth"]);
  const cross = routeFixture();
  assert.equal((await cross.route.POST(new Request(url, { method: "POST", headers: { origin: "https://evil.example" } }))).status, 403);
  assert.deepEqual(cross.calls, ["auth"]);
  const valid = routeFixture();
  const response = await valid.route.POST(new Request(url, { method: "POST", headers: { origin: "https://destination.example" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(valid.calls, ["auth", "body", "receive"]);
});
