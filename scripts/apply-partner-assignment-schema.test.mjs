import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ASSIGNMENT_MIGRATION_NAME,
  applyPartnerAssignmentSchema,
  resolveAssignmentDatabasePath,
} from "./apply-partner-assignment-schema.mjs";

// Databases are synthetic :memory: fixtures, plus one disposable URI probe
// file below .partner-import-check. The CLI never receives valid --apply.
// The actual workspace .env/database is never accessed.
const sql = fs.readFileSync(new URL("../prisma/migrations/20260928000300_add_partner_import_assignments/migration.sql", import.meta.url), "utf8");
const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ ledger = true, blockInsert = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE TeamAccount (id INTEGER PRIMARY KEY, username TEXT);
    CREATE TABLE PartnerImportDraft (id INTEGER PRIMARY KEY, status TEXT NOT NULL, updatedAt DATETIME NOT NULL, fields TEXT NOT NULL);
    CREATE TABLE TeacherSubmission (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO TeamAccount VALUES (1, 'Synthetic member');
    INSERT INTO PartnerImportDraft VALUES (1, 'pending', '2026-01-01', 'Synthetic private fixture');
    INSERT INTO TeacherSubmission VALUES (1, 'Synthetic existing submission');`);
  if (ledger) {
    db.exec(`CREATE TABLE "_prisma_migrations" (
      id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME,
      migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_steps_count INTEGER NOT NULL DEFAULT 0
      ${blockInsert ? ", CHECK (migration_name != '" + ASSIGNMENT_MIGRATION_NAME + "')" : ""}
    );
    INSERT INTO "_prisma_migrations"
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
      VALUES ('synthetic-prior-id', 'prior-checksum', 'synthetic-prior-migration', '2026-01-01', '2026-01-01', 1);`);
  }
  return db;
}
function records(db) {
  return plain({
    members: db.prepare("SELECT id, username FROM TeamAccount").all(),
    drafts: db.prepare("SELECT id, status, updatedAt, fields FROM PartnerImportDraft").all(),
    submissions: db.prepare("SELECT id, name FROM TeacherSubmission").all(),
  });
}
function metadata(db) {
  return plain(db.prepare('SELECT * FROM "_prisma_migrations" ORDER BY migration_name').all());
}
function newColumns(db) {
  return db.prepare('PRAGMA table_info("PartnerImportDraft")').all().filter(row => row.name === "teamAccountId").length +
    db.prepare('PRAGMA table_info("TeacherSubmission")').all().filter(row => row.name === "partnerImportDraftId").length;
}

test("fresh application adds nullable relations and indexes while preserving all existing records and prior history", () => {
  const db = fixture();
  try {
    const before = records(db);
    const prior = metadata(db)[0];
    assert.equal(applyPartnerAssignmentSchema(db, sql), "ASSIGNMENT_SCHEMA_APPLIED");
    assert.deepEqual(records(db), before);
    assert.equal(newColumns(db), 2);
    assert.equal(db.prepare("SELECT teamAccountId FROM PartnerImportDraft").get().teamAccountId, null);
    assert.equal(db.prepare("SELECT partnerImportDraftId FROM TeacherSubmission").get().partnerImportDraftId, null);
    const history = metadata(db);
    assert.equal(history.length, 2);
    assert.deepEqual(history.find(row => row.id === prior.id), prior);
    const current = history.find(row => row.migration_name === ASSIGNMENT_MIGRATION_NAME);
    assert.equal(current.checksum, checksum);
    assert.match(current.id, /^[0-9a-f-]{36}$/);
    assert.equal(current.applied_steps_count, 1);
    assert.ok(current.finished_at);
    assert.equal(current.rolled_back_at, null);
  } finally { db.close(); }
});

test("a second application is idempotent only with matching schema and migration checksum", () => {
  const db = fixture();
  try {
    applyPartnerAssignmentSchema(db, sql);
    const before = metadata(db);
    const existing = records(db);
    assert.equal(applyPartnerAssignmentSchema(db, sql), "ASSIGNMENT_SCHEMA_ALREADY_APPLIED");
    assert.deepEqual(metadata(db), before);
    assert.deepEqual(records(db), existing);
    db.prepare('UPDATE "_prisma_migrations" SET checksum = ? WHERE migration_name = ?').run("incorrect-checksum", ASSIGNMENT_MIGRATION_NAME);
    assert.throws(() => applyPartnerAssignmentSchema(db, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
  } finally { db.close(); }
});

test("partial structures are refused instead of guessing missing steps", () => {
  for (const prepare of [
    db => db.exec(sql.split(";")[0] + ";"),
    db => db.exec(sql),
    db => db.prepare('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES (?,?,?,?,1)')
      .run("synthetic-current-id", checksum, ASSIGNMENT_MIGRATION_NAME, "2026-01-01"),
  ]) {
    const db = fixture();
    try {
      prepare(db);
      const beforeColumns = newColumns(db);
      const beforeHistory = metadata(db);
      const beforeRecords = records(db);
      assert.throws(() => applyPartnerAssignmentSchema(db, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
      assert.equal(newColumns(db), beforeColumns);
      assert.deepEqual(metadata(db), beforeHistory);
      assert.deepEqual(records(db), beforeRecords);
    } finally { db.close(); }
  }
});

test("matching names alone cannot accept wrong index columns, uniqueness or foreign-key behavior", () => {
  for (const corrupt of [
    db => db.exec('DROP INDEX "PartnerImportDraft_teamAccountId_status_updatedAt_idx"; CREATE INDEX "PartnerImportDraft_teamAccountId_status_updatedAt_idx" ON "PartnerImportDraft"("status");'),
    db => db.exec('DROP INDEX "TeacherSubmission_partnerImportDraftId_key"; CREATE INDEX "TeacherSubmission_partnerImportDraftId_key" ON "TeacherSubmission"("partnerImportDraftId");'),
  ]) {
    const db = fixture();
    try {
      applyPartnerAssignmentSchema(db, sql); corrupt(db);
      assert.throws(() => applyPartnerAssignmentSchema(db, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
    } finally { db.close(); }
  }
  const db = fixture();
  try {
    db.exec(sql.replaceAll("ON DELETE RESTRICT", "ON DELETE CASCADE"));
    db.prepare('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES (?,?,?,?,1)')
      .run("synthetic-current-id", checksum, ASSIGNMENT_MIGRATION_NAME, "2026-01-01");
    assert.throws(() => applyPartnerAssignmentSchema(db, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
  } finally { db.close(); }
});

test("failure registering metadata rolls back every schema change without exposing SQLite details", () => {
  const db = fixture({ blockInsert: true });
  try {
    const before = records(db);
    const history = metadata(db);
    assert.throws(() => applyPartnerAssignmentSchema(db, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
    assert.equal(newColumns(db), 0);
    assert.equal(db.prepare('PRAGMA index_list("PartnerImportDraft")').all().length, 0);
    assert.deepEqual(records(db), before);
    assert.deepEqual(metadata(db), history);
  } finally { db.close(); }
});

test("missing migration history and SQL outside the exact requested migration are refused", () => {
  const missing = fixture({ ledger: false });
  try {
    assert.throws(() => applyPartnerAssignmentSchema(missing, sql), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
    assert.equal(newColumns(missing), 0);
    assert.equal(missing.prepare('PRAGMA table_info("_prisma_migrations")').all().length, 0);
  } finally { missing.close(); }
  const db = fixture();
  try {
    const before = records(db);
    assert.throws(() => applyPartnerAssignmentSchema(db, sql + "\nDELETE FROM TeamAccount;"), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
    assert.equal(newColumns(db), 0);
    assert.deepEqual(records(db), before);
  } finally { db.close(); }
});

test("database resolution is schema-relative and rejects missing/outside/symlinked/directory targets using only fake filesystem metadata", () => {
  const root = path.resolve("synthetic-workspace");
  const filename = path.join(root, "prisma", "fixture.db");
  const fake = {
    realpathSync(value) {
      if (value === root || value === filename) return value;
      throw new Error("SYNTHETIC_PRIVATE_PATH");
    },
    statSync: () => ({ isFile: () => true }),
  };
  assert.equal(resolveAssignmentDatabasePath("file:./fixture.db", root, fake), filename);
  assert.equal(resolveAssignmentDatabasePath(pathToFileURL(filename).href, root, fake), filename);
  for (const url of ["file:../../outside.db", "file:./missing.db", "file::memory:", "postgresql://private.example/db"]) {
    assert.throws(() => resolveAssignmentDatabasePath(url, root, fake), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
  }
  const outside = path.resolve(root, "..", "outside.db");
  assert.throws(() => resolveAssignmentDatabasePath("file:./fixture.db", root, {
    ...fake, realpathSync: value => value === root ? root : outside,
  }), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
  assert.throws(() => resolveAssignmentDatabasePath("file:./fixture.db", root, {
    ...fake, statSync: () => ({ isFile: () => false }),
  }), /^Error: ASSIGNMENT_SCHEMA_FAILED$/);
});

test("CLI requires exactly --apply before environment or database access and emits only its fixed guard code", () => {
  const script = fileURLToPath(new URL("./apply-partner-assignment-schema.mjs", import.meta.url));
  for (const args of [[], ["--dry-run"], ["--apply", "--extra"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "ASSIGNMENT_SCHEMA_APPLY_REQUIRED\n");
    assert.equal(result.stderr, "");
  }
});

test("SQLite mode=rw URI opens the existing synthetic file and never creates a missing database", () => {
  const prefix = fileURLToPath(new URL("../.partner-import-check/assignment-schema-uri-", import.meta.url));
  const directory = fs.mkdtempSync(prefix);
  const existing = path.join(directory, "synthetic-existing.db");
  const missing = path.join(directory, "synthetic-missing.db");
  try {
    const created = new DatabaseSync(existing);
    try { created.exec("CREATE TABLE SyntheticFixture (id INTEGER PRIMARY KEY)"); }
    finally { created.close(); }
    const existingUri = pathToFileURL(existing);
    existingUri.searchParams.set("mode", "rw");
    const opened = new DatabaseSync(existingUri.href, { enableForeignKeyConstraints: true, allowExtension: false });
    try { assert.equal(opened.prepare('PRAGMA table_info("SyntheticFixture")').all().length, 1); }
    finally { opened.close(); }
    const missingUri = pathToFileURL(missing);
    missingUri.searchParams.set("mode", "rw");
    assert.equal(fs.existsSync(missing), false);
    assert.throws(() => new DatabaseSync(missingUri.href, { enableForeignKeyConstraints: true, allowExtension: false }));
    assert.equal(fs.existsSync(missing), false);
  } finally {
    // Only these fixed synthetic filenames are removed; no recursive deletion.
    if (fs.existsSync(existing)) fs.unlinkSync(existing);
    if (fs.existsSync(missing)) fs.unlinkSync(missing);
    fs.rmdirSync(directory);
  }
});
