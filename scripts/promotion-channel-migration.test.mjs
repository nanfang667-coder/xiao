import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = new URL('../prisma/migrations/20261011000100_add_promotion_channels/migration.sql', import.meta.url);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE User (id INTEGER PRIMARY KEY, referralCode TEXT, referredBy INTEGER, siteId TEXT);
    CREATE TABLE ReferralVisit (id INTEGER PRIMARY KEY, referrerId INTEGER, visitorKey TEXT, visitCount INTEGER);
    CREATE TABLE SiteVisit (id INTEGER PRIMARY KEY, siteId TEXT, visitorKey TEXT, visitCount INTEGER);
    INSERT INTO User VALUES (1, 'AB3', NULL, 'fixture-site');
    INSERT INTO User VALUES (2, 'CD4', 1, 'fixture-site');
    INSERT INTO ReferralVisit VALUES (1, 1, 'fixture-referral-key', 9);
    INSERT INTO SiteVisit VALUES (1, 'fixture-site', 'fixture-site-key', 15);`);
  const before = legacySnapshot(db);
  db.exec(fs.readFileSync(migration, 'utf8'));
  return { db, before };
}

function legacySnapshot(db) {
  return Object.fromEntries(['User', 'ReferralVisit', 'SiteVisit'].map(table => [table, {
    sql: db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', table).sql,
    rows: db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row })),
  }]));
}

function addChannel(db, id = 'fixture-channel', code = 'gp77', hostname = 'gp77.example.test') {
  db.prepare(`INSERT INTO PromotionChannel (id, code, name, hostname, updatedAt)
    VALUES (?, ?, 'Fixture channel', ?, CURRENT_TIMESTAMP)`).run(id, code, hostname);
}

function addVisit(db, channelId = 'fixture-channel', visitorKey = 'fixture-browser-key') {
  db.prepare('INSERT INTO PromotionChannelVisit (channelId, visitorKey) VALUES (?, ?)').run(channelId, visitorKey);
}

test('channel migration preserves existing user attribution and all invitation and site statistics', () => {
  const { db, before } = setup();
  try {
    assert.deepEqual(legacySnapshot(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM PromotionChannel').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM PromotionChannelVisit').get().count, 0);
    addChannel(db);
    addVisit(db);
    assert.deepEqual(legacySnapshot(db), before);
  } finally { db.close(); }
});

test('channel codes and short domains remain unique in the database', () => {
  const { db } = setup();
  try {
    addChannel(db);
    assert.throws(() => addChannel(db, 'fixture-duplicate-code', 'gp77', 'other.example.test'), /UNIQUE/);
    assert.throws(() => addChannel(db, 'fixture-duplicate-host', 'other', 'gp77.example.test'), /UNIQUE/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM PromotionChannel').get().count, 1);
    assert.equal(db.prepare('SELECT isActive FROM PromotionChannel').get().isActive, 1);
  } finally { db.close(); }
});

test('visitor deduplication is per channel and orphan visitor rows are rejected', () => {
  const { db } = setup();
  try {
    addChannel(db);
    addChannel(db, 'fixture-second-channel', 'ad2', 'ad2.example.test');
    addVisit(db);
    assert.throws(() => addVisit(db), /UNIQUE/);
    addVisit(db, 'fixture-second-channel');
    addVisit(db, 'fixture-channel', 'second-browser-key');
    assert.throws(() => addVisit(db, 'missing-channel'), /FOREIGN KEY/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM PromotionChannelVisit').get().count, 3);
    for (const row of db.prepare('SELECT visitCount, firstVisitedAt, lastVisitedAt FROM PromotionChannelVisit').all()) {
      assert.equal(row.visitCount, 1);
      assert.ok(row.firstVisitedAt);
      assert.ok(row.lastVisitedAt);
    }
  } finally { db.close(); }
});

test('disabling a promotion channel keeps its accumulated visitor history', () => {
  const { db, before } = setup();
  try {
    addChannel(db);
    addVisit(db);
    db.prepare('UPDATE PromotionChannelVisit SET visitCount = 7 WHERE channelId = ?').run('fixture-channel');
    const history = db.prepare('SELECT * FROM PromotionChannelVisit').all();
    db.prepare('UPDATE PromotionChannel SET isActive = 0 WHERE id = ?').run('fixture-channel');
    assert.deepEqual(db.prepare('SELECT * FROM PromotionChannelVisit').all(), history);
    assert.throws(() => db.prepare('DELETE FROM PromotionChannel WHERE id = ?').run('fixture-channel'), /FOREIGN KEY/);
    assert.deepEqual(legacySnapshot(db), before);
  } finally { db.close(); }
});
