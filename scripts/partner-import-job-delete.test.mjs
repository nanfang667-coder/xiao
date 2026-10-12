import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";

// All records below live in a fresh in-memory database. Only source code and the
// checked-in migration are read; no Prisma client, .env, uploads or network runs.
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherJobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const missingJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sentinel = "SYNTHETIC_PRIVATE_RECORD";
const plain = value => JSON.parse(JSON.stringify(value));
const moduleSource = fs.readFileSync(new URL("../src/lib/partner-import-job-delete.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const migration = fs.readFileSync(new URL("../prisma/migrations/20260928000100_add_partner_imports/migration.sql", import.meta.url), "utf8");
class PartnerImportError extends Error {}

function form(id = jobId, confirmed = true) {
  const data = new FormData();
  if (id !== undefined) data.set("jobId", id);
  if (confirmed) data.set("confirmDelete", "yes");
  return data;
}

function setup(options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE Teacher (id INTEGER PRIMARY KEY, name TEXT, photos TEXT);");
  db.exec(migration);
  db.prepare("INSERT INTO Teacher (id, name, photos) VALUES (1, ?, ?)").run(sentinel, '["synthetic-public.jpg"]');
  db.prepare("INSERT INTO PartnerImportSource (id, name, origin, rules, updatedAt) VALUES (1, ?, 'https://partner.example', '{}', CURRENT_TIMESTAMP)").run(sentinel);
  db.exec("INSERT INTO PartnerImportedPost (id, sourceId, sourceUrl, teacherId, revision) VALUES (1, 1, 'https://partner.example/post/1', 1, 1)");
  db.prepare("INSERT INTO PartnerImportDraft (id, postId, contentHash, status, fields, photos, updatedAt) VALUES (1, 1, 'synthetic-hash-pending', 'pending', ?, ?, CURRENT_TIMESTAMP)")
    .run(JSON.stringify({ name: sentinel }), '["synthetic-private-pending.jpg"]');
  db.prepare("INSERT INTO PartnerImportDraft (id, postId, contentHash, status, fields, photos, updatedAt) VALUES (2, 1, 'synthetic-hash-published', 'published', ?, ?, CURRENT_TIMESTAMP)")
    .run(JSON.stringify({ name: sentinel }), '["synthetic-private-published.jpg"]');
  for (const id of [jobId, otherJobId]) {
    db.prepare("INSERT INTO PartnerImportJob (id, sourceId, listUrl, rules, imageOrigins) VALUES (?, 1, 'https://partner.example/?page=1', '{}', '[]')").run(id);
  }
  const insertItem = db.prepare("INSERT INTO PartnerImportItem (jobId, sourceUrl, status, draftId, lockedAt, lockToken) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [index, status] of ["queued", "failed", "imported", "skipped"].entries()) {
    insertItem.run(jobId, "https://partner.example/post/" + index, status, index % 2 + 1, null, null);
  }
  insertItem.run(otherJobId, "https://partner.example/post/elsewhere", "processing", null, "2000-01-01 00:00:00", sentinel);
  if (options.processing) db.prepare("UPDATE PartnerImportItem SET status='processing', lockedAt=?, lockToken=? WHERE jobId=? AND sourceUrl=?")
    .run(options.expired ? "2000-01-01 00:00:00" : "2099-01-01 00:00:00", sentinel, jobId, "https://partner.example/post/0");
  const calls = [];
  const tables = ["Teacher", "PartnerImportSource", "PartnerImportedPost", "PartnerImportDraft", "PartnerImportJob", "PartnerImportItem"];
  const snapshot = () => Object.fromEntries(tables.map(table => [table, plain(db.prepare("SELECT * FROM " + table + " ORDER BY id").all())]));
  const prisma = new Proxy({
    partnerImportJob: {
      deleteMany: async args => {
        calls.push(["deleteMany", plain(args)]);
        assert.deepEqual(plain(args), { where: { id: args.where.id, items: { none: { status: "processing" } } } });
        if (options.deleteError) throw new Error(sentinel);
        const result = db.prepare("DELETE FROM PartnerImportJob WHERE id=? AND NOT EXISTS (SELECT 1 FROM PartnerImportItem WHERE jobId=PartnerImportJob.id AND status='processing')")
          .run(args.where.id);
        return { count: Number(result.changes) };
      },
      findUnique: async args => {
        calls.push(["findUnique", plain(args)]);
        assert.deepEqual(plain(args), { where: { id: args.where.id }, select: { id: true } });
        if (options.findError) throw new Error(sentinel);
        return db.prepare("SELECT id FROM PartnerImportJob WHERE id=?").get(args.where.id) ?? null;
      },
    },
  }, { get(target, key) {
    assert.ok(Object.hasOwn(target, key), "Unexpected database delegate");
    return target[key];
  } });
  const exports = {};
  const recoverExpiredItems = async id => {
    calls.push(["recoverExpiredItems", id]);
    if (options.recoveryError) throw new Error(sentinel);
    db.prepare("UPDATE PartnerImportItem SET status=\'queued\', lockedAt=NULL, lockToken=NULL WHERE jobId=? AND status=\'processing\' AND lockedAt < ?")
      .run(id, new Date(Date.now() - 10 * 60 * 1000).toISOString());
  };
  const mocks = { "server-only": {}, "./prisma": { prisma }, "./partner-import": { PartnerImportError, recoverExpiredItems } };
  vm.runInNewContext(compiled, { exports, FormData, require(name) {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected source dependency");
    return mocks[name];
  } });
  return { db, calls, snapshot, api: exports };
}

test("confirmation and a single valid UUID are required before any database access", async () => {
  const cases = [
    form(jobId, false), form(""), form("not-a-uuid"), form("-".repeat(36)),
    form("aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa"), form("aaaaaaaa-aaaa-4aaa-4aaa-aaaaaaaaaaaa"),
    form(jobId + " "), form("../" + jobId), form(jobId + "?secret=" + sentinel),
  ];
  const missing = form();
  missing.delete("jobId");
  cases.push(missing);
  const repeatedId = form();
  repeatedId.append("jobId", jobId);
  cases.push(repeatedId);
  const repeatedConfirmation = form();
  repeatedConfirmation.append("confirmDelete", "yes");
  cases.push(repeatedConfirmation);
  const falseConfirmation = form();
  falseConfirmation.set("confirmDelete", "true");
  cases.push(falseConfirmation);
  const fileId = form();
  fileId.set("jobId", new Blob([jobId]), "fake-id.txt");
  cases.push(fileId);
  const f = setup();
  try {
    const before = f.snapshot();
    for (const input of cases) {
      await assert.rejects(f.api.deleteImportJob(input), error => {
        assert.ok(error instanceof PartnerImportError);
        assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_RECORD|secret=|fake-id/);
        return true;
      });
    }
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.db.close(); }
});

test("one atomic deletion cascades only task items and preserves drafts, photos, indexes, sources and public posts", async () => {
  const f = setup();
  try {
    const before = f.snapshot();
    const result = await f.api.deleteImportJob(form());
    assert.equal(result.deletedJobId, jobId);
    assert.match(result.message, /已删除导入任务记录/);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_RECORD|partner\.example|synthetic-private|synthetic-public/);
    assert.deepEqual(f.calls, [["recoverExpiredItems", jobId], ["deleteMany", {
      where: { id: jobId, items: { none: { status: "processing" } } },
    }]]);
    const after = f.snapshot();
    assert.deepEqual(after.PartnerImportJob, before.PartnerImportJob.filter(row => row.id !== jobId));
    assert.deepEqual(after.PartnerImportItem, before.PartnerImportItem.filter(row => row.jobId !== jobId));
    for (const table of ["Teacher", "PartnerImportSource", "PartnerImportedPost", "PartnerImportDraft"]) {
      assert.deepEqual(after[table], before[table], table + " is untouched");
    }
  } finally { f.db.close(); }
});

test("an active processing lease blocks deletion until the item is no longer processing", async () => {
  const f = setup({ processing: true });
  try {
    const before = f.snapshot();
    await assert.rejects(f.api.deleteImportJob(form()), error => {
      assert.ok(error instanceof PartnerImportError);
      assert.equal(error.message, "任务仍有正在处理的条目，请先暂停导入，等待当前条目处理完成后再删除。");
      return true;
    });
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.calls.map(call => call[0]), ["recoverExpiredItems", "deleteMany", "findUnique"]);
    assert.deepEqual(f.calls[2][1], { where: { id: jobId }, select: { id: true } });
    f.db.prepare("UPDATE PartnerImportItem SET status='failed' WHERE jobId=? AND status='processing'").run(jobId);
    assert.equal((await f.api.deleteImportJob(form())).deletedJobId, jobId);
  } finally { f.db.close(); }
});

test("missing or already deleted tasks return a fixed message after the atomic attempt", async () => {
  const f = setup();
  try {
    await assert.rejects(f.api.deleteImportJob(form(missingJobId)), error => {
      assert.ok(error instanceof PartnerImportError);
      assert.equal(error.message, "任务记录不存在或已删除，请刷新任务列表。");
      assert.doesNotMatch(error.message, /cccccccc|SYNTHETIC_PRIVATE_RECORD/);
      return true;
    });
    assert.deepEqual(f.calls.map(call => call[0]), ["recoverExpiredItems", "deleteMany", "findUnique"]);
    await f.api.deleteImportJob(form());
    await assert.rejects(f.api.deleteImportJob(form()), /任务记录不存在或已删除/);
  } finally { f.db.close(); }
});

test("concurrent duplicate submissions can delete one task only once", async () => {
  const f = setup();
  try {
    const before = f.snapshot();
    const outcomes = await Promise.allSettled([f.api.deleteImportJob(form()), f.api.deleteImportJob(form())]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    const failure = outcomes.find(result => result.status === "rejected");
    assert.ok(failure.reason instanceof PartnerImportError);
    assert.equal(failure.reason.message, "任务记录不存在或已删除，请刷新任务列表。");
    assert.deepEqual(f.snapshot().PartnerImportDraft, before.PartnerImportDraft);
    assert.equal(f.snapshot().PartnerImportJob.length, 1);
  } finally { f.db.close(); }
});

test("database failure details never escape through deletion or existence checks", async () => {
  for (const options of [{ recoveryError: true }, { deleteError: true }, { processing: true, findError: true }]) {
    const f = setup(options);
    try {
      const before = f.snapshot();
      await assert.rejects(f.api.deleteImportJob(form()), error => {
        assert.ok(error instanceof PartnerImportError);
        assert.equal(error.message, "任务记录删除失败，请稍后重试。");
        assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_RECORD/);
        return true;
      });
      assert.deepEqual(f.snapshot(), before);
    } finally { f.db.close(); }
  }
});


test("expired leases are recovered before deletion while other tasks and saved content remain", async () => {
  const f = setup({ processing: true, expired: true });
  try {
    const before = f.snapshot();
    const result = await f.api.deleteImportJob(form());
    assert.equal(result.deletedJobId, jobId);
    assert.deepEqual(f.calls.map(call => call[0]), ["recoverExpiredItems", "deleteMany"]);
    const after = f.snapshot();
    assert.deepEqual(after.PartnerImportItem, before.PartnerImportItem.filter(row => row.jobId !== jobId));
    for (const table of ["Teacher", "PartnerImportSource", "PartnerImportedPost", "PartnerImportDraft"]) {
      assert.deepEqual(after[table], before[table]);
    }
  } finally { f.db.close(); }
});
