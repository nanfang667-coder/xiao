import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  QUOTA_HISTORY_MIGRATION_NAME,
  applyTeamQuotaHistorySchema,
  resolveQuotaHistoryDatabasePath,
  selectQuotaHistoryDatabaseUrl,
} from "./apply-team-quota-history-schema.mjs";

// Every database in this suite is synthetic and in memory. CLI tests never
// pass valid --apply, so neither .env nor the workspace database is accessed.
const sql = fs.readFileSync(new URL("../prisma/migrations/20261001000100_add_team_post_quota_events/migration.sql", import.meta.url), "utf8");
const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const ERROR = /^Error: QUOTA_HISTORY_SCHEMA_FAILED$/;

function fixture({ ledger = true, blockInsert = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE TeamAccount (
    id INTEGER PRIMARY KEY, username TEXT, passwordHash TEXT NOT NULL,
    monthlyPostLimit INTEGER NOT NULL, monthlyPostLimitOverride INTEGER,
    monthlyPostBonus INTEGER NOT NULL, monthlyPostBonusMonth TEXT
  );
  INSERT INTO TeamAccount VALUES
    (1, 'synthetic-september', 'SYNTHETIC_HASH', 150, NULL, 50, '2026-09'),
    (2, 'synthetic-override-22', 'SYNTHETIC_HASH', 30, 22, 10, '2026-08'),
    (3, 'synthetic-override-150', 'SYNTHETIC_HASH', 30, 150, 20, '2026-09'),
    (4, 'synthetic-legacy-30', 'SYNTHETIC_HASH', 30, NULL, 0, NULL),
    (5, 'synthetic-legacy-22', 'SYNTHETIC_HASH', 22, NULL, 5, '2026-09'),
    (6, 'synthetic-invalid-base', 'SYNTHETIC_HASH', 99, NULL, 5, NULL),
    (7, 'synthetic-invalid-override', 'SYNTHETIC_HASH', 150, 99, 5, NULL),
    (8, 'synthetic-negative-bonus', 'SYNTHETIC_HASH', 30, NULL, -5, '2026-09');
  CREATE TABLE UnrelatedSyntheticData (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO UnrelatedSyntheticData VALUES (1, 'unchanged');`);
  if (ledger) {
    db.exec(`CREATE TABLE "_prisma_migrations" (
      id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME,
      migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_steps_count INTEGER NOT NULL DEFAULT 0
      ${blockInsert ? ", CHECK (migration_name != '" + QUOTA_HISTORY_MIGRATION_NAME + "')" : ""}
    );
    INSERT INTO "_prisma_migrations"
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
      VALUES ('synthetic-prior-id', 'prior-checksum', 'synthetic-prior-migration', '2026-01-01', '2026-01-01', 1);`);
  }
  return db;
}
const accounts = db => plain(db.prepare("SELECT * FROM TeamAccount ORDER BY id").all());
const events = db => plain(db.prepare("SELECT * FROM TeamPostQuotaEvent ORDER BY id").all());
const history = db => plain(db.prepare('SELECT * FROM "_prisma_migrations" ORDER BY migration_name').all());
const eventColumns = db => db.prepare('PRAGMA table_info("TeamPostQuotaEvent")').all();

test("applies only the quota table and indexes, preserving accounts, unrelated rows and prior migration history", () => {
  const db = fixture();
  try {
    const before = accounts(db);
    const prior = history(db)[0];
    assert.equal(applyTeamQuotaHistorySchema(db, sql), "QUOTA_HISTORY_SCHEMA_APPLIED");
    assert.deepEqual(accounts(db), before);
    assert.deepEqual(plain(db.prepare("SELECT * FROM UnrelatedSyntheticData").all()), [{ id: 1, value: "unchanged" }]);
    assert.equal(eventColumns(db).length, 10);
    const indexes = db.prepare('PRAGMA index_list("TeamPostQuotaEvent")').all();
    assert.equal(indexes.length, 4);
    const recorded = history(db);
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded.find(row => row.id === prior.id), prior);
    const added = recorded.find(row => row.migration_name === QUOTA_HISTORY_MIGRATION_NAME);
    assert.equal(added.checksum, checksum);
    assert.match(added.id, /^[0-9a-f-]{36}$/);
    assert.equal(added.applied_steps_count, 1);
    assert.ok(added.finished_at);
    assert.equal(added.rolled_back_at, null);
  } finally { db.close(); }
});

test("snapshots use effective permanent quotas and legacy metadata, never invented September operations or dates", () => {
  const db = fixture();
  try {
    const start = Date.now();
    applyTeamQuotaHistorySchema(db, sql);
    const end = Date.now();
    const captured = events(db);
    assert.equal(captured.length, 8);
    assert.deepEqual(captured.map(row => row.newLimit), [200, 32, 170, 30, 27, 35, 155, 30]);
    for (const row of captured) {
      assert.equal(row.kind, "legacy_snapshot");
      assert.equal(row.delta, null);
      assert.equal(row.previousLimit, null);
      assert.equal(typeof row.createdAt, "number");
      assert.ok(Number.isInteger(row.createdAt));
      // SQLite and Node use clocks with different resolution on Windows.
      // Still require a current epoch-millisecond value, never a backdated date.
      assert.ok(row.createdAt >= start - 1000 && row.createdAt <= end + 1000);
      assert.equal(Object.hasOwn(row, "passwordHash"), false);
    }
    assert.equal(captured[0].legacyBonus, 50);
    assert.equal(captured[0].legacyMonth, "2026-09");
    assert.equal(captured[1].legacyMonth, "2026-08");
    assert.equal(captured[3].legacyMonth, null);
    assert.equal(captured[7].legacyBonus, -5);
  } finally { db.close(); }
});

test("integer snapshot timestamps sort correctly with later Prisma-style events", () => {
  const db = fixture();
  try {
    applyTeamQuotaHistorySchema(db, sql);
    const latest = db.prepare("SELECT MAX(createdAt) AS createdAt FROM TeamPostQuotaEvent").get().createdAt;
    const added = db.prepare(`INSERT INTO TeamPostQuotaEvent
      (teamAccountId, teamUsername, kind, delta, previousLimit, newLimit, createdAt)
      VALUES (1, 'synthetic-september', 'allowance_added', 10, 200, 210, ?)`)
      .run(latest + 1);
    const ordered = db.prepare("SELECT id, kind, typeof(createdAt) AS storage FROM TeamPostQuotaEvent ORDER BY createdAt DESC, id DESC").all();
    assert.equal(ordered[0].id, Number(added.lastInsertRowid));
    assert.equal(ordered[0].kind, "allowance_added");
    assert.ok(ordered.every(row => row.storage === "integer"));
  } finally { db.close(); }
});

test("repeated application keeps a single unchanged baseline after account quota changes", () => {
  const db = fixture();
  try {
    applyTeamQuotaHistorySchema(db, sql);
    const captured = events(db);
    const metadata = history(db);
    db.exec("UPDATE TeamAccount SET monthlyPostBonus = monthlyPostBonus + 100 WHERE id = 1");
    assert.equal(applyTeamQuotaHistorySchema(db, sql), "QUOTA_HISTORY_SCHEMA_ALREADY_APPLIED");
    assert.deepEqual(events(db), captured);
    assert.deepEqual(history(db), metadata);
    db.prepare('UPDATE "_prisma_migrations" SET checksum = ? WHERE migration_name = ?').run("wrong-checksum", QUOTA_HISTORY_MIGRATION_NAME);
    assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
    assert.deepEqual(events(db), captured);
  } finally { db.close(); }
});

test("account deletion keeps historical account name and quota; account id updates cascade", () => {
  const db = fixture();
  try {
    applyTeamQuotaHistorySchema(db, sql);
    db.exec("UPDATE TeamAccount SET id = 90, username = 'synthetic-renamed' WHERE id = 1");
    const renamed = db.prepare("SELECT * FROM TeamPostQuotaEvent WHERE id = 1").get();
    assert.equal(renamed.teamAccountId, 90);
    assert.equal(renamed.teamUsername, "synthetic-september");
    db.exec("DELETE FROM TeamAccount WHERE id = 90");
    const retained = db.prepare("SELECT * FROM TeamPostQuotaEvent WHERE id = 1").get();
    assert.equal(retained.teamAccountId, null);
    assert.equal(retained.teamUsername, "synthetic-september");
    assert.equal(retained.newLimit, 200);
    assert.equal(events(db).length, 8);
    assert.throws(() => db.exec(`INSERT INTO TeamPostQuotaEvent
      (teamAccountId, teamUsername, kind, delta, previousLimit, newLimit)
      VALUES (999, 'missing', 'allowance_added', 10, 30, 40)`));
  } finally { db.close(); }
});

test("schema and baseline insertion both roll back when migration metadata cannot be registered", () => {
  const db = fixture({ blockInsert: true });
  try {
    const before = accounts(db);
    const metadata = history(db);
    assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
    assert.equal(eventColumns(db).length, 0);
    assert.deepEqual(accounts(db), before);
    assert.deepEqual(history(db), metadata);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'TeamPostQuotaEvent%'").get().count, 0);
  } finally { db.close(); }
});

test("bad legacy data rolls back the new table and does not print private SQLite diagnostics", () => {
  const db = fixture();
  try {
    db.exec("UPDATE TeamAccount SET username = NULL WHERE id = 2");
    const before = accounts(db);
    const metadata = history(db);
    assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
    assert.equal(eventColumns(db).length, 0);
    assert.deepEqual(accounts(db), before);
    assert.deepEqual(history(db), metadata);
  } finally { db.close(); }
});

test("partial schemas or migration metadata are refused without recreating snapshots", () => {
  for (const prepare of [
    db => db.exec(sql.split(";")[0] + ";"),
    db => db.exec(sql),
    db => db.prepare('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES (?,?,?,?,1)')
      .run("synthetic-current-id", checksum, QUOTA_HISTORY_MIGRATION_NAME, "2026-01-01"),
  ]) {
    const db = fixture();
    try {
      prepare(db);
      const columnsBefore = plain(eventColumns(db));
      const eventsBefore = columnsBefore.length ? events(db) : [];
      const before = accounts(db);
      const metadata = history(db);
      assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
      assert.deepEqual(plain(eventColumns(db)), columnsBefore);
      assert.deepEqual(columnsBefore.length ? events(db) : [], eventsBefore);
      assert.deepEqual(accounts(db), before);
      assert.deepEqual(history(db), metadata);
    } finally { db.close(); }
  }
});

test("wrong indexed columns, uniqueness, column defaults and foreign key behavior cannot pass readiness", () => {
  for (const alteredSql of [
    sql.replace('ON "TeamPostQuotaEvent"("createdAt", "id")', 'ON "TeamPostQuotaEvent"("id", "createdAt")'),
    sql.replace('CREATE INDEX "TeamPostQuotaEvent_createdAt_id_idx"', 'CREATE UNIQUE INDEX "TeamPostQuotaEvent_createdAt_id_idx"'),
    sql.replace("ON DELETE SET NULL", "ON DELETE CASCADE"),
    sql.replace('"delta" INTEGER,', '"delta" INTEGER DEFAULT 0,'),
  ]) {
    const db = fixture();
    try {
      db.exec(alteredSql);
      db.prepare('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES (?,?,?,?,1)')
        .run("synthetic-current-id", checksum, QUOTA_HISTORY_MIGRATION_NAME, "2026-01-01");
      assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
    } finally { db.close(); }
  }
});

test("missing prerequisite schema or migration history and unrelated SQL are refused", () => {
  const missing = fixture({ ledger: false });
  try {
    assert.throws(() => applyTeamQuotaHistorySchema(missing, sql), ERROR);
    assert.equal(eventColumns(missing).length, 0);
  } finally { missing.close(); }
  const db = fixture();
  try {
    const before = accounts(db);
    assert.throws(() => applyTeamQuotaHistorySchema(db, sql + "\nDELETE FROM TeamAccount;"), ERROR);
    assert.equal(eventColumns(db).length, 0);
    assert.deepEqual(accounts(db), before);
    db.exec("ALTER TABLE TeamAccount DROP COLUMN monthlyPostBonusMonth");
    assert.throws(() => applyTeamQuotaHistorySchema(db, sql), ERROR);
    assert.equal(eventColumns(db).length, 0);
  } finally { db.close(); }
});

test("database resolution is local, existing and schema-relative using only fake filesystem metadata", () => {
  const root = path.resolve("synthetic-workspace");
  const filename = path.join(root, "prisma", "fixture.db");
  const fake = {
    realpathSync(value) {
      if (value === root || value === filename) return value;
      throw new Error("SYNTHETIC_PRIVATE_PATH");
    },
    statSync: () => ({ isFile: () => true }),
  };
  assert.equal(resolveQuotaHistoryDatabasePath("file:./fixture.db", root, fake), filename);
  assert.equal(resolveQuotaHistoryDatabasePath(pathToFileURL(filename).href, root, fake), filename);
  for (const url of ["file:../../outside.db", "file:./missing.db", "file::memory:", "postgresql://private.example/db"]) {
    assert.throws(() => resolveQuotaHistoryDatabasePath(url, root, fake), ERROR);
  }
  assert.throws(() => resolveQuotaHistoryDatabasePath("file:./fixture.db", root, {
    ...fake, realpathSync: value => value === root ? root : path.resolve(root, "..", "outside.db"),
  }), ERROR);
  assert.throws(() => resolveQuotaHistoryDatabasePath("file:./fixture.db", root, {
    ...fake, statSync: () => ({ isFile: () => false }),
  }), ERROR);
});

test("CLI requires exactly --apply before reading environment or opening a database", () => {
  const script = fileURLToPath(new URL("./apply-team-quota-history-schema.mjs", import.meta.url));
  for (const args of [[], ["--dry-run"], ["--apply", "--extra"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "QUOTA_HISTORY_SCHEMA_APPLY_REQUIRED\n");
    assert.equal(result.stderr, "");
  }
});

test("conflicting inherited DATABASE_URL is refused without exposing either target", () => {
  assert.equal(selectQuotaHistoryDatabaseUrl("file:./fixture.db", undefined), "file:./fixture.db");
  assert.equal(selectQuotaHistoryDatabaseUrl("file:./fixture.db", "file:./fixture.db"), "file:./fixture.db");
  for (const [fileValue, environmentValue] of [
    ["file:./fixture.db", "file:./different.db"],
    ["file:./fixture.db", ""],
    [undefined, "file:./fixture.db"],
  ]) assert.throws(() => selectQuotaHistoryDatabaseUrl(fileValue, environmentValue), ERROR);
});
