import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ASSIGNMENT_MIGRATION_NAME = "20260928000300_add_partner_import_assignments";
const WORKSPACE = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION_FILE = path.join(WORKSPACE, "prisma", "migrations", ASSIGNMENT_MIGRATION_NAME, "migration.sql");
const FAILURE = "ASSIGNMENT_SCHEMA_FAILED";
const REQUIRED = "ASSIGNMENT_SCHEMA_APPLY_REQUIRED";
const EXPECTED_SQL = `
ALTER TABLE "PartnerImportDraft" ADD COLUMN "teamAccountId" INTEGER
  REFERENCES "TeamAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherSubmission" ADD COLUMN "partnerImportDraftId" INTEGER
  REFERENCES "PartnerImportDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PartnerImportDraft_teamAccountId_status_updatedAt_idx"
  ON "PartnerImportDraft"("teamAccountId", "status", "updatedAt");
CREATE UNIQUE INDEX "TeacherSubmission_partnerImportDraftId_key"
  ON "TeacherSubmission"("partnerImportDraftId");
`;
const columns = {
  draft: { table: "PartnerImportDraft", name: "teamAccountId", parent: "TeamAccount" },
  submission: { table: "TeacherSubmission", name: "partnerImportDraftId", parent: "PartnerImportDraft" },
};
const indexes = [
  { table: "PartnerImportDraft", name: "PartnerImportDraft_teamAccountId_status_updatedAt_idx", unique: 0, columns: ["teamAccountId", "status", "updatedAt"] },
  { table: "TeacherSubmission", name: "TeacherSubmission_partnerImportDraftId_key", unique: 1, columns: ["partnerImportDraftId"] },
];

function fail() { throw new Error(FAILURE); }
const normalizeSql = value => value.replace(/--[^\r\n]*/g, "").replace(/\s+/g, " ").trim();
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const tableInfo = (db, table) => db.prepare("PRAGMA table_info(" + quote(table) + ")").all();
const indexList = (db, table) => db.prepare("PRAGMA index_list(" + quote(table) + ")").all();
const migrationRows = db => db.prepare(
  'SELECT "checksum", "finished_at", "rolled_back_at", "applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name" = ?',
).all(ASSIGNMENT_MIGRATION_NAME);

function validateBaseSchema(db) {
  for (const table of ["PartnerImportDraft", "TeacherSubmission", "TeamAccount"]) {
    const info = tableInfo(db, table);
    const id = info.find(column => column.name === "id");
    if (!id || String(id.type).toUpperCase() !== "INTEGER" || id.pk !== 1) fail();
    if (table === "PartnerImportDraft" && !["status", "updatedAt"].every(name => info.some(column => column.name === name))) fail();
  }
  const ledger = tableInfo(db, "_prisma_migrations");
  const required = ["id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count"];
  // Existing migration history is required. This script never invents a baseline.
  if (!required.every(name => ledger.some(column => column.name === name))) fail();
}

function validateAddedSchema(db) {
  for (const field of Object.values(columns)) {
    const column = tableInfo(db, field.table).find(item => item.name === field.name);
    if (!column || String(column.type).toUpperCase() !== "INTEGER" || column.notnull !== 0 ||
        column.pk !== 0 || column.dflt_value !== null) fail();
    const foreignKeys = db.prepare("PRAGMA foreign_key_list(" + quote(field.table) + ")").all().filter(item => item.from === field.name);
    if (foreignKeys.length !== 1 || foreignKeys[0].table !== field.parent || foreignKeys[0].to !== "id" ||
        foreignKeys[0].on_delete !== "RESTRICT" || foreignKeys[0].on_update !== "CASCADE") fail();
  }
  for (const expected of indexes) {
    const index = indexList(db, expected.table).find(item => item.name === expected.name);
    if (!index || index.unique !== expected.unique || index.partial !== 0 || index.origin !== "c") fail();
    // PRAGMA index_info is schema metadata, and verifies the indexed columns
    // rather than accepting any index which happens to share the expected name.
    const actual = db.prepare("PRAGMA index_info(" + quote(expected.name) + ")").all().map(item => item.name);
    if (JSON.stringify(actual) !== JSON.stringify(expected.columns)) fail();
  }
}

function validateMigrationRow(db, checksum) {
  const rows = migrationRows(db);
  if (rows.length !== 1 || rows[0].checksum !== checksum || rows[0].finished_at === null ||
      rows[0].rolled_back_at !== null || rows[0].applied_steps_count !== 1) fail();
}

// The caller owns db; tests use :memory:. The only record read/written by this
// function is this migration's metadata. No post/member data is selected.
export function applyPartnerAssignmentSchema(db, migrationSql) {
  let began = false;
  try {
    if (typeof migrationSql !== "string" || normalizeSql(migrationSql) !== normalizeSql(EXPECTED_SQL)) fail();
    const checksum = createHash("sha256").update(migrationSql, "utf8").digest("hex");
    db.exec("PRAGMA foreign_keys = ON");
    if (db.prepare("PRAGMA foreign_keys").get().foreign_keys !== 1) fail();
    db.exec("BEGIN IMMEDIATE");
    began = true;
    validateBaseSchema(db);
    const present = [
      ...Object.values(columns).map(field => tableInfo(db, field.table).some(item => item.name === field.name)),
      ...indexes.map(index => indexList(db, index.table).some(item => item.name === index.name)),
      migrationRows(db).length > 0,
    ];
    if (present.every(Boolean)) {
      validateAddedSchema(db);
      validateMigrationRow(db, checksum);
      db.exec("COMMIT");
      began = false;
      return "ASSIGNMENT_SCHEMA_ALREADY_APPLIED";
    }
    // Partial schemas or pre-existing metadata require deliberate review;
    // never guess which ALTER/CREATE statements should be skipped.
    if (present.some(Boolean)) fail();
    db.exec(migrationSql);
    validateAddedSchema(db);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
      VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`).run(randomUUID(), checksum, now, ASSIGNMENT_MIGRATION_NAME, now);
    validateMigrationRow(db, checksum);
    db.exec("COMMIT");
    began = false;
    return "ASSIGNMENT_SCHEMA_APPLIED";
  } catch {
    if (began) { try { db.exec("ROLLBACK"); } catch { /* Keep database diagnostics private. */ } }
    fail();
  }
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

export function resolveAssignmentDatabasePath(databaseUrl, workspace = WORKSPACE, io = fs) {
  try {
    if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("file:") ||
        /[\0\r\n?#]/.test(databaseUrl)) fail();
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
  } catch {
    fail();
  }
}

async function main(args) {
  if (args.length !== 1 || args[0] !== "--apply") {
    process.stdout.write(REQUIRED + "\n");
    process.exitCode = 2;
    return;
  }
  let db;
  try {
    // Only explicit --apply reaches dotenv or any database operation.
    const dotenv = await import("dotenv");
    const loaded = dotenv.config({ path: path.join(WORKSPACE, ".env"), quiet: true });
    if (loaded.error) fail();
    const filename = resolveAssignmentDatabasePath(loaded.parsed?.DATABASE_URL);
    const uri = pathToFileURL(filename);
    // mode=rw refuses creation even if the file disappears between the
    // existence checks and SQLite opening it.
    uri.searchParams.set("mode", "rw");
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(uri.href, { enableForeignKeyConstraints: true, allowExtension: false });
    db.exec("PRAGMA busy_timeout = 5000");
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    process.stdout.write(applyPartnerAssignmentSchema(db, sql) + "\n");
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
