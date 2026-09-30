import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

const key = '00000000-0000-4000-8000-000000000001';
const quotaApi = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/team-post-quota.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: quotaApi });

function setup({ authorized = true, quota = 100, fail = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE TeacherSubmission (
    id INTEGER PRIMARY KEY, photos TEXT,
    teamAccountId INTEGER, kind TEXT, status TEXT, createdAt TEXT
  );`);
  db.exec(fs.readFileSync(new URL('../prisma/migrations/20260917000100_deduplicate_team_submissions/migration.sql', import.meta.url), 'utf8'));
  let uploads = 0;
  const deleted = [];
  const submission = {
    findUnique: async ({ where }) => db.prepare('SELECT id FROM TeacherSubmission WHERE submissionKey = ?').get(where.submissionKey),
    count: async ({ where }) => {
      const params = [where.teamAccountId, where.kind, ...where.status.in];
      let sql = 'SELECT COUNT(*) AS n FROM TeacherSubmission WHERE teamAccountId = ? AND kind = ? AND status IN (?, ?)';
      if (where.createdAt) {
        sql += ' AND createdAt >= ? AND createdAt < ?';
        params.push(where.createdAt.gte.toISOString(), where.createdAt.lt.toISOString());
      }
      return db.prepare(sql).get(...params).n;
    },
    create: async ({ data, select }) => {
      assert.deepEqual(JSON.parse(JSON.stringify(select)), { id: true }, "Do not return new columns before schema activation");
      if (fail) throw new Error('failed write');
      db.prepare('INSERT INTO TeacherSubmission (submissionKey, photos, teamAccountId, kind, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(data.submissionKey, data.photos, data.teamAccountId, data.kind, data.status, new Date().toISOString());
    },
  };
  const mocks = {
    'next/navigation': { redirect: url => { throw new Error('REDIRECT:' + url); } },
    'next/cache': { revalidatePath() {} },
    '@/lib/team-auth': { requireTeamAccount: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); return { id: 7, siteId: 'test' }; } },
    '@/lib/rate-limit': {}, '@/lib/request-ip': {},
    '@/lib/prisma': { prisma: { teacherSubmission: submission, $transaction: fn => fn({ teacherSubmission: submission }) } },
    '@/lib/photo': { defaultGradients: () => [], emojiFor: () => '' },
    '@/lib/image-upload': { getSelectedPhotoFiles: () => [], saveUploadedPhotos: async () => [`/uploads/test-${++uploads}.jpg`] },
    '@/lib/uploaded-photos': { deleteUploadedPhotos: async photos => deleted.push(...JSON.parse(photos)) },
    '@/lib/teacher-post-input': { extractTeacherPostFields: () => ({ name: 'Test', type: '钢琴' }) },
    '@/lib/team-post-quota': { ...quotaApi, getEffectiveTeamPostLimit: () => quota },
  };
  const exports = {};
  const source = fs.readFileSync(new URL('../src/app/team/actions.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require(name) { assert.ok(name in mocks, name); return mocks[name]; },
  });
  return { submit: id => exports.createTeamTeacherSubmission(id, new FormData()), db, deleted, uploads: () => uploads };
}

test('concurrent retries create one submission and remove only losing upload', async () => {
  const api = setup();
  try {
    const results = await Promise.allSettled([api.submit(key), api.submit(key)]);
    for (const result of results) assert.match(result.reason.message, /REDIRECT:\/team\/posts\?submitted=1/);
    const rows = api.db.prepare('SELECT * FROM TeacherSubmission').all();
    assert.equal(rows.length, 1);
    assert.equal(api.deleted.length, 1);
    assert.ok(!JSON.parse(rows[0].photos).includes(api.deleted[0]));
    await assert.rejects(api.submit(key), /submitted=1/);
    assert.equal(api.uploads(), 2);
    await assert.rejects(api.submit('00000000-0000-4000-8000-000000000002'), /submitted=1/);
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM TeacherSubmission').get().n, 2);
  } finally { api.db.close(); }
});

test('authentication, malformed keys and quota prevent new uploads', async () => {
  for (const [options, id, expected] of [
    [{ authorized: false }, key, /UNAUTHORIZED/],
    [{}, 'invalid', /Invalid submission/],
    [{ quota: 0 }, key, /error=quota/],
  ]) {
    const api = setup(options);
    try { await assert.rejects(api.submit(id), expected); assert.equal(api.uploads(), 0); }
    finally { api.db.close(); }
  }
});

test('historical usage is restored and only remaining lifetime quota can be spent', async () => {
  const api = setup({ quota: 22 });
  try {
    const insert = api.db.prepare('INSERT INTO TeacherSubmission (photos, teamAccountId, kind, status, createdAt) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 21; i++) {
      insert.run('[]', 7, 'create', i % 2 ? 'pending' : 'approved', '2026-08-01T00:00:00.000Z');
    }
    insert.run('[]', 7, 'create', 'rejected', '2026-08-01T00:00:00.000Z');
    insert.run('[]', 7, 'update', 'approved', '2026-08-01T00:00:00.000Z');
    insert.run('[]', 8, 'create', 'approved', '2026-08-01T00:00:00.000Z');
    await assert.rejects(api.submit(key), /submitted=1/);
    assert.equal(api.uploads(), 1);
    await assert.rejects(api.submit('00000000-0000-4000-8000-000000000002'), /error=quota/);
    assert.equal(api.uploads(), 1);
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM TeacherSubmission').get().n, 25);
    // Idempotent retries still succeed even after the last allowance is used.
    await assert.rejects(api.submit(key), /submitted=1/);
    assert.equal(api.uploads(), 1);
  } finally { api.db.close(); }
});

test('failed database writes remove uploaded files and report failure', async () => {
  const api = setup({ fail: true });
  try {
    await assert.rejects(api.submit(key), /error=generic/);
    assert.deepEqual(api.deleted, ['/uploads/test-1.jpg']);
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM TeacherSubmission').get().n, 0);
  } finally { api.db.close(); }
});

test('migration preserves old submissions and allows multiple legacy null keys', () => {
  const api = setup();
  try {
    api.db.exec('INSERT INTO TeacherSubmission (photos) VALUES (\'[]\'), (\'[]\');');
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM TeacherSubmission WHERE submissionKey IS NULL').get().n, 2);
  } finally { api.db.close(); }
});
