import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const QUOTA_HISTORY_MIGRATION_NAME = "20261001000100_add_team_post_quota_events";
const WORKSPACE = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION_FILE = path.join(WORKSPACE, "prisma", "migrations", QUOTA_HISTORY_MIGRATION_NAME, "migration.sql");
const FAILURE = "QUOTA_HISTORY_SCHEMA_FAILED";
const REQUIRED = "QUOTA_HISTORY_SCHEMA_APPLY_REQUIRED";
const TABLE = "TeamPostQuotaEvent";
const EXPECTED_SQL = `
CREATE TABLE "TeamPostQuotaEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamAccountId" INTEGER,
    "teamUsername" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER,
    "previousLimit" INTEGER,
    "newLimit" INTEGER NOT NULL,
    "legacyBonus" INTEGER,
    "legacyMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamPostQuotaEvent_teamAccountId_fkey" FOREIGN KEY ("teamAccountId") REFERENCES "TeamAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TeamPostQuotaEvent_createdAt_id_idx" ON "TeamPostQuotaEvent"("createdAt", "id");
CREATE INDEX "TeamPostQuotaEvent_teamAccountId_createdAt_idx" ON "TeamPostQuotaEvent"("teamAccountId", "createdAt");
CREATE INDEX "TeamPostQuotaEvent_teamUsername_createdAt_idx" ON "TeamPostQuotaEvent"("teamUsername", "createdAt");
CREATE INDEX "TeamPostQuotaEvent_legacyMonth_idx" ON "TeamPostQuotaEvent"("legacyMonth");
INSERT INTO "TeamPostQuotaEvent" (
    "teamAccountId", "teamUsername", "kind", "delta", "previousLimit", "newLimit", "legacyBonus", "legacyMonth", "createdAt"
)
SELECT "id", "username", 'legacy_snapshot', NULL, NULL,
    (CASE
        WHEN "monthlyPostLimitOverride" IN (22, 150) THEN "monthlyPostLimitOverride"
        WHEN "monthlyPostLimit" IN (22, 30, 150) THEN "monthlyPostLimit"
        ELSE 30
    END) + MAX(0, CAST("monthlyPostBonus" AS INTEGER)),
    "monthlyPostBonus", "monthlyPostBonusMonth",
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "TeamAccount";
`;
const expectedColumns = [
  ["id", "INTEGER", 1, 1, null],
  ["teamAccountId", "INTEGER", 0, 0, null],
  ["teamUsername", "TEXT", 1, 0, null],
  ["kind", "TEXT", 1, 0, null],
  ["delta", "INTEGER", 0, 0, null],
  ["previousLimit", "INTEGER", 0, 0, null],
  ["newLimit", "INTEGER", 1, 0, null],
  ["legacyBonus", "INTEGER", 0, 0, null],
  ["legacyMonth", "TEXT", 0, 0, null],
  ["createdAt", "DATETIME", 1, 0, "CURRENT_TIMESTAMP"],
];
const expectedIndexes = [
  ["TeamPostQuotaEvent_createdAt_id_idx", ["createdAt", "id"]],
  ["TeamPostQuotaEvent_teamAccountId_createdAt_idx", ["teamAccountId", "createdAt"]],
  ["TeamPostQuotaEvent_teamUsername_createdAt_idx", ["teamUsername", "createdAt"]],
  ["TeamPostQuotaEvent_legacyMonth_idx", ["legacyMonth"]],
];

function fail() { throw new Error(FAILURE); }
const normalizeSql = value => value.replace(/--[^\r\n]*/g, "").replace(/\s+/g, " ").trim();
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const tableInfo = (db, table) => db.prepare("PRAGMA table_info(" + quote(table) + ")").all();
const migrationRows = db => db.prepare(
  'SELECT "checksum", "finished_at", "rolled_back_at", "applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name" = ?',
).all(QUOTA_HISTORY_MIGRATION_NAME);

function validateBaseSchema(db) {
  const account = tableInfo(db, "TeamAccount");
  for (const [name, type] of [
    ["id", "INTEGER"], ["username", "TEXT"], ["monthlyPostLimit", "INTEGER"],
    ["monthlyPostLimitOverride", "INTEGER"], ["monthlyPostBonus", "INTEGER"], ["monthlyPostBonusMonth", "TEXT"],
  ]) {
    const column = account.find(item => item.name === name);
    if (!column || String(column.type).toUpperCase() !== type || (name === "id" && column.pk !== 1)) fail();
  }
  const ledger = tableInfo(db, "_prisma_migrations");
  // A known Prisma migration ledger is required; never invent a baseline.
  const required = ["id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count"];
  if (!required.every(name => ledger.some(column => column.name === name))) fail();
}

function validateAddedSchema(db) {
  const actualColumns = tableInfo(db, TABLE).map(column => [
    column.name, String(column.type).toUpperCase(), column.notnull, column.pk, column.dflt_value,
  ]);
  if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) fail();
  const definition = db.prepare('SELECT "sql" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?').get("table", TABLE);
  if (!definition || !/\bAUTOINCREMENT\b/i.test(definition.sql)) fail();
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(" + quote(TABLE) + ")").all();
  if (foreignKeys.length !== 1 || foreignKeys[0].from !== "teamAccountId" || foreignKeys[0].table !== "TeamAccount" ||
      foreignKeys[0].to !== "id" || foreignKeys[0].on_delete !== "SET NULL" || foreignKeys[0].on_update !== "CASCADE") fail();
  const indexes = db.prepare("PRAGMA index_list(" + quote(TABLE) + ")").all();
  for (const [name, columns] of expectedIndexes) {
    const index = indexes.find(item => item.name === name);
    if (!index || index.unique !== 0 || index.partial !== 0 || index.origin !== "c") fail();
    const actual = db.prepare("PRAGMA index_info(" + quote(name) + ")").all().map(item => item.name);
    if (JSON.stringify(actual) !== JSON.stringify(columns)) fail();
  }
}

function validateMigrationRow(db, checksum) {
  const rows = migrationRows(db);
  if (rows.length !== 1 || rows[0].checksum !== checksum || rows[0].finished_at === null ||
      rows[0].rolled_back_at !== null || rows[0].applied_steps_count !== 1) fail();
}

// The caller owns db; tests pass synthetic :memory: databases. The SQL copies
// only current quota fields into baseline rows without returning account data.
export function applyTeamQuotaHistorySchema(db, migrationSql) {
  let began = false;
  try {
    if (typeof migrationSql !== "string" || normalizeSql(migrationSql) !== normalizeSql(EXPECTED_SQL)) fail();
    const checksum = createHash("sha256").update(migrationSql, "utf8").digest("hex");
    db.exec("PRAGMA foreign_keys = ON");
    if (db.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1) fail();
    db.exec("BEGIN IMMEDIATE");
    began = true;
    validateBaseSchema(db);
    const tablePresent = tableInfo(db, TABLE).length > 0;
    const ledgerPresent = migrationRows(db).length > 0;
    if (tablePresent && ledgerPresent) {
      validateAddedSchema(db);
      validateMigrationRow(db, checksum);
      db.exec("COMMIT");
      began = false;
      return "QUOTA_HISTORY_SCHEMA_ALREADY_APPLIED";
    }
    // Partial application is refused rather than duplicating old snapshots.
    if (tablePresent || ledgerPresent) fail();
    db.exec(migrationSql);
    validateAddedSchema(db);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
      VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`).run(randomUUID(), checksum, now, QUOTA_HISTORY_MIGRATION_NAME, now);
    validateMigrationRow(db, checksum);
    db.exec("COMMIT");
    began = false;
    return "QUOTA_HISTORY_SCHEMA_APPLIED";
  } catch {
    if (began) { try { db.exec("ROLLBACK"); } catch { /* Do not disclose database diagnostics. */ } }
    fail();
  }
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

export function selectQuotaHistoryDatabaseUrl(fileDatabaseUrl, environmentDatabaseUrl) {
  if (typeof fileDatabaseUrl !== "string" ||
      (environmentDatabaseUrl !== undefined && environmentDatabaseUrl !== fileDatabaseUrl)) fail();
  return fileDatabaseUrl;
}

export function resolveQuotaHistoryDatabasePath(databaseUrl, workspace = WORKSPACE, io = fs) {
  try {
    if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("file:") || /[\0\r\n?#]/.test(databaseUrl)) fail();
    let filename;
    if (databaseUrl.startsWith("file://")) filename = fileURLToPath(new URL(databaseUrl));
    else {
      filename = decodeURIComponent(databaseUrl.slice(5));
      if (!filename || filename === ":memory:" || (/^[a-z]:/i.test(filename) && !path.isAbsolute(filename))) fail();
    }
    const root = path.resolve(workspace);
    const candidate = path.resolve(root, "prisma", filename);
    if (!within(root, candidate)) fail();
    const realRoot = io.realpathSync(root);
    const realFile = io.realpathSync(candidate);
    if (!within(realRoot, realFile) || !io.statSync(realFile).isFile()) fail();
    return realFile;
  } catch { fail(); }
}

async function main(args) {
  if (args.length !== 1 || args[0] !== "--apply") {
    process.stdout.write(REQUIRED + "\n");
    process.exitCode = 2;
    return;
  }
  let db;
  try {
    // Environment and database access require the explicit --apply option.
    const dotenv = await import("dotenv");
    const loaded = dotenv.config({ path: path.join(WORKSPACE, ".env"), quiet: true });
    if (loaded.error) fail();
    // dotenv preserves pre-existing environment values. Refuse ambiguity rather
    // than migrate a different database from the one used by the app process.
    const databaseUrl = selectQuotaHistoryDatabaseUrl(loaded.parsed?.DATABASE_URL, process.env.DATABASE_URL);
    const filename = resolveQuotaHistoryDatabasePath(databaseUrl);
    const uri = pathToFileURL(filename);
    uri.searchParams.set("mode", "rw");
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(uri.href, { enableForeignKeyConstraints: true, allowExtension: false });
    db.exec("PRAGMA busy_timeout = 5000");
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    process.stdout.write(applyTeamQuotaHistorySchema(db, sql) + "\n");
  } catch {
    process.stdout.write(FAILURE + "\n");
    process.exitCode = 1;
  } finally {
    if (db) { try { db.close(); } catch { /* Never print connection diagnostics. */ } }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
