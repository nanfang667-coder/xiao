import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE Teacher (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO Teacher VALUES (1, 'Fixture only');");
  db.exec(fs.readFileSync(new URL("../prisma/migrations/20260928000100_add_partner_imports/migration.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO PartnerImportSource (name, origin, rules, updatedAt) VALUES ('Fixture', 'https://partner.example', '{}', CURRENT_TIMESTAMP);
    INSERT INTO PartnerImportedPost (sourceId, sourceUrl) VALUES (1, 'https://partner.example/listing/1');
    INSERT INTO PartnerImportDraft (postId, contentHash, fields, photos, updatedAt) VALUES (1, 'test-hash', '{}', '[]', CURRENT_TIMESTAMP);`);
  return db;
}

test("migration preserves existing public posts and defaults imports to pending", () => {
  const db = setup();
  try {
    assert.deepEqual({...db.prepare("SELECT * FROM Teacher").get()}, {id:1,name:"Fixture only"});
    assert.deepEqual({...db.prepare("SELECT status, version, baseRevision FROM PartnerImportDraft").get()}, {status:"pending",version:1,baseRevision:0});
    assert.equal(db.prepare("SELECT teacherId FROM PartnerImportedPost").get().teacherId, null);
  } finally { db.close(); }
});

test("database constraints prevent duplicate sources, content versions and job entries", () => {
  const db = setup();
  try {
    assert.throws(() => db.exec("INSERT INTO PartnerImportedPost (sourceId, sourceUrl) VALUES (1, 'https://partner.example/listing/1')"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO PartnerImportDraft (postId, contentHash, fields, photos, updatedAt) VALUES (1, 'test-hash', '{}', '[]', CURRENT_TIMESTAMP)"), /UNIQUE/);
    db.exec("INSERT INTO PartnerImportJob (id, sourceId, listUrl, rules, imageOrigins) VALUES ('fixture-job', 1, 'https://partner.example/?page=1', '{}', '[]');");
    db.exec("INSERT INTO PartnerImportItem (jobId, sourceUrl) VALUES ('fixture-job', 'https://partner.example/listing/1');");
    assert.throws(() => db.exec("INSERT INTO PartnerImportItem (jobId, sourceUrl) VALUES ('fixture-job', 'https://partner.example/listing/1')"), /UNIQUE/);
    assert.throws(() => db.exec("DELETE FROM PartnerImportSource WHERE id=1"), /FOREIGN KEY/);
    db.exec("DELETE FROM PartnerImportJob WHERE id='fixture-job'");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM PartnerImportItem").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM PartnerImportDraft").get().count, 1);
  } finally { db.close(); }
});
