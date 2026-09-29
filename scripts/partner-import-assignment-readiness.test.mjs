import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import * as coverApi from "../src/lib/partner-import-photo-cover.ts";

// Verification uses only synthetic metadata/state. The Prisma integration test
// gets an explicit newly created temporary database URL, never project config.
function load(file, mocks) {
  const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, FormData, Date, URL, Buffer, TextDecoder, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected dependency: " + name);
    return mocks[name];
  } });
  return exports;
}
class PartnerImportError extends Error {}
function loadReadiness(prisma) {
  return load("src/lib/partner-import-assignment-readiness.ts", {
    "server-only": {}, "./prisma": { prisma },
  });
}
function metadataClient({ draftField = true, submissionField = true, draftColumn = true, submissionColumn = true, fail = false } = {}) {
  const calls = [];
  const client = {
    partnerImportDraft: { fields: draftField ? { teamAccountId: {} } : {} },
    teacherSubmission: { fields: submissionField ? { partnerImportDraftId: {} } : {} },
    async $queryRawUnsafe(sql) {
      calls.push(sql);
      if (fail) throw new Error("SYNTHETIC_PRIVATE_DATABASE_PATH");
      if (sql === 'PRAGMA table_info("PartnerImportDraft")') return [{ name: "id" }, ...(draftColumn ? [{ name: "teamAccountId" }] : [])];
      if (sql === 'PRAGMA table_info("TeacherSubmission")') return [{ name: "id" }, ...(submissionColumn ? [{ name: "partnerImportDraftId" }] : [])];
      throw new Error("Unexpected metadata query");
    },
  };
  return { client, calls };
}

test("old live clients fail readiness before any database call", async () => {
  for (const options of [{ draftField: false }, { submissionField: false }]) {
    const { client, calls } = metadataClient(options);
    const api = loadReadiness(client);
    assert.equal(await api.isPartnerImportAssignmentReady(), false);
    await assert.rejects(api.requirePartnerImportAssignmentReady(), error => {
      assert.ok(error instanceof api.PartnerImportAssignmentUnavailableError);
      assert.equal(error.message, "分配流程尚未启用，请完成数据库升级并重启服务后再试。");
      return true;
    });
    assert.deepEqual(calls, []);
  }
});

test("new clients require both new columns and query only fixed schema metadata", async () => {
  for (const options of [{ draftColumn: false }, { submissionColumn: false }, {}, { fail: true }]) {
    const { client, calls } = metadataClient(options);
    const api = loadReadiness(client);
    const ready = options.draftColumn !== false && options.submissionColumn !== false && !options.fail;
    assert.equal(await api.isPartnerImportAssignmentReady(), ready);
    assert.ok(calls.length <= 2);
    assert.ok(calls.every(sql => /^PRAGMA table_info\("(?:PartnerImportDraft|TeacherSubmission)"\)$/.test(sql)));
    if (!ready) await assert.rejects(api.requirePartnerImportAssignmentReady(), error => !error.message.includes("SYNTHETIC_PRIVATE"));
  }
});

test("negative readiness is not cached after schema becomes available", async () => {
  const { client, calls } = metadataClient({ draftColumn: false });
  const api = loadReadiness(client);
  assert.equal(await api.isPartnerImportAssignmentReady(), false);
  client.$queryRawUnsafe = async sql => {
    calls.push(sql);
    return [{ name: sql.includes("PartnerImportDraft") ? "teamAccountId" : "partnerImportDraftId" }];
  };
  assert.equal(await api.isPartnerImportAssignmentReady(), true);
});

test("all assignment operations stop at readiness before reading records or mutating", async () => {
  const unavailable = loadReadiness(metadataClient({ draftField: false }).client);
  const deny = new Proxy({}, { get() { throw new Error("Unexpected database record access"); } });
  const api = load("src/lib/partner-import-assignment.ts", {
    "server-only": {}, "./prisma": { prisma: deny }, "./partner-import": { PartnerImportError },
    "./partner-import-assignment-readiness": unavailable,
    "./teacher-post-input": {}, "./partner-import-declarations": {}, "./partner-import-photos": {},
    "./partner-import-photo-cover": {}, "./team-post-quota": {}, "./photo": {},
  });
  for (const call of [
    () => api.approveImportDrafts(new FormData()),
    () => api.assignImportDrafts(new FormData()),
    () => api.saveAssignedImportDraft(1, 1, 1, new FormData()),
    () => api.reviewAssignedImportDraft(1, "approve", undefined, 1),
    () => api.reviewAssignedImportDraft(1, "return", "synthetic", 1),
  ]) await assert.rejects(call(), error => error instanceof PartnerImportError && error.message === unavailable.PARTNER_ASSIGNMENT_UNAVAILABLE);
});

function legacyFixture(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE TeacherSubmission(id INTEGER PRIMARY KEY);");
    db.exec(fs.readFileSync(new URL("../prisma/migrations/20260928000100_add_partner_imports/migration.sql", import.meta.url), "utf8"));
    db.exec('CREATE TABLE "Teacher" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "type" TEXT NOT NULL, "city" TEXT NOT NULL, "district" TEXT NOT NULL, "price" TEXT NOT NULL, "services" TEXT NOT NULL, "courseNotes" TEXT, "age" TEXT, "photos" TEXT NOT NULL, "emoji" TEXT NOT NULL, "phone" TEXT NOT NULL, "wechat" TEXT NOT NULL, "qq" TEXT, "otherContact" TEXT, "address" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "isNationallyPromoted" BOOLEAN NOT NULL DEFAULT false, "promotionOrder" INTEGER NOT NULL DEFAULT 100, "promotionStartsAt" DATETIME, "promotionEndsAt" DATETIME, "source" TEXT, "sourceId" INTEGER, "viewCount" INTEGER NOT NULL DEFAULT 0); CREATE UNIQUE INDEX "Teacher_source_sourceId_key" ON "Teacher"("source","sourceId");');
  } finally { db.close(); }
}

test("current Prisma client can import, save, reject and publish against an unmigrated synthetic schema", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "partner-assignment-compat-"));
  const databasePath = path.join(directory, "synthetic.db");
  legacyFixture(databasePath);
  const prisma = new PrismaClient({ datasources: { db: { url: "file:" + databasePath.replaceAll("\\", "/") } } });
  const readiness = {};
  const fields = { name: "虚构兼容稿", type: "钢琴", city: "虚构市", district: "", price: "", services: "虚构服务",
    courseNotes: null, age: "28", phone: "synthetic-contact", wechat: "", qq: null, otherContact: null, address: null };
  let content = 0;
  const core = load("src/lib/partner-import.ts", {
    "server-only": {}, "node:crypto": crypto, "./prisma": { prisma },
    "./partner-import-assignment-readiness": readiness,
    "./partner-import-fetch": { fetchPartnerResource: async url => ({ bytes: Buffer.from("synthetic"), contentType: "text/html", url }) },
    "./partner-import-parser": {
      normalizePartnerImportRules: () => ({}),
      parsePartnerListing: () => ["https://partner.example/post/1"],
      parsePartnerDetail: () => ({ fields: { ...fields, name: fields.name + content }, photoUrls: [] }),
    },
    "./partner-import-photos": {
      downloadPartnerPhotos: async () => ({ keys: [], hashes: [] }),
      parsePartnerPhotoKeys: value => JSON.parse(value),
      publishPartnerPhotos: async () => [],
      removePartnerPrivatePhotos: async () => 0,
    },
    "./uploaded-photos": { deleteUploadedPhotos: async () => {} },
    "./teacher-post-input": load("src/lib/teacher-post-input.ts", {}),
    "./partner-import-declarations": load("src/lib/partner-import-declarations.ts", {}),
    "./partner-import-photo-cover": coverApi,
    "./partner-import-errors": load("src/lib/partner-import-errors.ts", {}),
    "./photo": { defaultGradients: () => ["synthetic-gradient"], emojiFor: () => "🎹" },
  });
  Object.assign(readiness, loadReadiness(prisma));
  try {
    assert.equal(await readiness.isPartnerImportAssignmentReady(), false);
    await prisma.partnerImportSource.create({ data: { name: "synthetic", origin: "https://partner.example", rules: "{}", imageOrigins: "[]" } });
    async function importDraft() {
      const form = new FormData();
      form.set("sourceId", "1");
      form.set("listUrl", "https://partner.example/?page=1");
      const id = await core.createImportJob(form);
      const progress = await core.processImportStep(id);
      assert.equal(progress.imported, 1);
    }
    await importDraft();
    const draft = await prisma.partnerImportDraft.findFirst({ select: { id: true, version: true } });
    assert.ok(draft);
    function reviewForm(intent) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) if (typeof value === "string") form.set(key, value);
      form.set("intent", intent);
      form.set("confirmPublish", "yes");
      form.set("postRevision", "0");
      return form;
    }
    const saved = await core.reviewImportDraft(draft.id, draft.version, reviewForm("save"));
    assert.equal(saved.version, 2);
    const published = await core.reviewImportDraft(draft.id, 2, reviewForm("publish"));
    assert.equal(published.teacherId, 1);
    assert.equal(await prisma.teacher.count(), 1);
    content++;
    await importDraft();
    const other = await prisma.partnerImportDraft.findFirst({ where: { status: "pending" }, select: { id: true, version: true } });
    assert.ok(other);
    await core.reviewImportDraft(other.id, other.version, reviewForm("reject"));
    assert.equal(await prisma.partnerImportDraft.count({ where: { status: "rejected" } }), 1);
    assert.equal(await readiness.isPartnerImportAssignmentReady(), false);
  } finally {
    await prisma.$disconnect();
    // The only removable file is the synthetic path created above; no recursive deletion.
    fs.unlinkSync(databasePath);
    fs.rmdirSync(directory);
  }
});
