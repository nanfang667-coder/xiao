import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function load(file, mocks = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  vm.runInNewContext(outputText, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function adminActions({ authorized = true, supportsCompensation = false } = {}) {
  const events = [];
  const writes = [];
  const refreshed = [];
  const record = { id: 7, photos: '[]', supportsCompensation };
  const teacher = {
    create: async ({ data }) => {
      events.push('create');
      writes.push(plain(data));
      Object.assign(record, data);
      return record;
    },
    findUnique: async ({ where }) => {
      assert.equal(where.id, record.id);
      return { ...record };
    },
    update: async ({ where, data }) => {
      assert.equal(where.id, record.id);
      events.push('update');
      writes.push(plain(data));
      Object.assign(record, data);
      return record;
    },
  };
  const api = load('src/app/adminzhangzhang/actions.ts', {
    'fs/promises': {}, path: {}, 'next/headers': {},
    'next/navigation': { redirect: path => { throw new Error('REDIRECT:' + path); } },
    'next/cache': { revalidatePath: path => refreshed.push(path) },
    '@/lib/auth': { requireAdmin: async () => {
      events.push('authorize');
      if (!authorized) throw new Error('UNAUTHORIZED');
    } },
    '@/lib/prisma': { prisma: {
      teacher,
      $transaction: async callback => {
        events.push('transaction');
        return callback({ teacher, partnerImportedPost: { updateMany: async () => ({ count: 0 }) } });
      },
    } },
    '@/lib/admin-teacher-return': load('src/lib/admin-teacher-return.ts'),
    '@/lib/photo': { emojiFor: () => 'fixture', defaultGradients: () => ['fixture-gradient'] },
    '@/lib/image-upload': {
      getSelectedPhotoFiles: () => [],
      saveUploadedPhotos: async () => { events.push('upload'); return []; },
    },
    '@/lib/admin-session': {}, '@/lib/admin-login-limit': {}, '@/lib/admin-login-limit-token': {},
    '@/lib/request-ip': {}, '@/lib/admin-session-token': {},
  });
  return { api, events, writes, refreshed, record };
}

test('administrator creation enables compensation only for the checked checkbox value', async () => {
  for (const [values, expected] of [
    [{}, false],
    [{ supportsCompensation: 'on' }, true],
    [{ supportsCompensation: 'off' }, false],
    [{ supportsCompensation: 'true' }, false],
    [{ supportsCompensation: '' }, false],
  ]) {
    const result = adminActions();
    await assert.rejects(result.api.createTeacher(form(values)), /REDIRECT:\/adminzhangzhang\/teachers$/);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].supportsCompensation, expected);
    assert.equal(result.events[0], 'authorize');
    assert.ok(result.refreshed.includes('/'));
  }
});

test('administrator updates persist both enabling and clearing an existing compensation flag', async () => {
  const result = adminActions();
  await assert.rejects(result.api.updateTeacher(7, '', form({ supportsCompensation: 'on' })), /REDIRECT:/);
  assert.equal(result.record.supportsCompensation, true);
  await assert.rejects(result.api.updateTeacher(7, '', form()), /REDIRECT:/);
  assert.equal(result.record.supportsCompensation, false);
  assert.deepEqual(result.writes.map(data => data.supportsCompensation), [true, false]);
  assert.ok(result.refreshed.includes('/listing/7'));
});

test('unauthorized compensation changes cannot upload files or write database records', async () => {
  for (const operation of ['create', 'update']) {
    const result = adminActions({ authorized: false, supportsCompensation: true });
    const pending = operation === 'create'
      ? result.api.createTeacher(form({ supportsCompensation: 'on' }))
      : result.api.updateTeacher(7, '', form());
    await assert.rejects(pending, /UNAUTHORIZED/);
    assert.deepEqual(result.events, ['authorize']);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.refreshed, []);
    assert.equal(result.record.supportsCompensation, true);
  }
});

test('team post parsing ignores forged compensation fields instead of enabling or clearing them', () => {
  const { extractTeacherPostFields } = load('src/lib/teacher-post-input.ts');
  const valid = { name: 'Synthetic teacher', services: 'Synthetic services', phone: 'fixture-contact' };
  const expected = plain(extractTeacherPostFields(form(valid)));
  for (const value of ['on', 'off', 'true', 'false']) {
    const fields = plain(extractTeacherPostFields(form({ ...valid, supportsCompensation: value })));
    assert.deepEqual(fields, expected);
    assert.equal(Object.hasOwn(fields, 'supportsCompensation'), false);
  }
});

test('approving a team edit preserves compensation even if the submission contains a forged flag', async () => {
  for (const supportsCompensation of [false, true]) {
    const teacher = { id: 7, photos: '[]', supportsCompensation };
    const writes = [];
    const submission = {
      id: 21, submissionKey: '3:fixture', kind: 'update', status: 'pending', teamAccountId: 3, teacherId: 7,
      name: 'Synthetic teacher', photos: '[]', supportsCompensation: !supportsCompensation,
    };
    const tx = {
      teacherSubmission: { findUnique: async () => submission, update: async () => ({ id: 21 }) },
      teacherOwnership: { findUnique: async () => ({ teamAccountId: 3, teacher }) },
      teacher: { update: async ({ data }) => { writes.push(plain(data)); Object.assign(teacher, data); } },
    };
    const api = load('src/app/adminzhangzhang/submissions/actions.ts', {
      'next/cache': { revalidatePath() {} },
      '@/lib/auth': { requireAdmin: async () => {} },
      '@/lib/prisma': { prisma: { $transaction: async callback => callback(tx) } },
      '@/lib/partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => true },
      '@/lib/uploaded-photos': { deleteUploadedPhotos: async () => {} },
    });
    await api.approveTeacherSubmission(21);
    assert.equal(writes.length, 1);
    assert.equal(Object.hasOwn(writes[0], 'supportsCompensation'), false);
    assert.equal(teacher.supportsCompensation, supportsCompensation);
  }
});

test('partner publication defaults new posts to false and preserves existing administrator compensation choices', async () => {
  const { extractTeacherPostFields } = load('src/lib/teacher-post-input.ts');
  const fields = extractTeacherPostFields(form({
    name: 'Synthetic teacher', services: 'Synthetic services', phone: 'fixture-contact', supportsCompensation: 'on',
  }));
  for (const initial of [undefined, false, true]) {
    let teacher = initial === undefined ? null : { id: 7, photos: '[]', supportsCompensation: initial };
    let writes = 0;
    const tx = {
      partnerImportDraft: { updateMany: async () => ({ count: 1 }) },
      partnerImportedPost: { updateMany: async () => ({ count: 1 }), update: async () => ({}) },
      teacher: {
        findUnique: async () => teacher,
        upsert: async ({ create, update }) => {
          for (const data of [create, update]) assert.equal(Object.hasOwn(data, 'supportsCompensation'), false);
          teacher = teacher ? { ...teacher, ...update } : { id: 7, supportsCompensation: false, ...create };
          writes += 1;
          return teacher;
        },
      },
    };
    const api = load('src/lib/partner-import.ts', {
      'server-only': {}, 'node:crypto': {},
      './prisma': { prisma: { $transaction: async callback => callback(tx) } },
      './partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => true },
      './partner-import-fetch': {}, './partner-import-parser': {}, './partner-import-errors': {},
      './partner-import-declarations': {}, './partner-import-photo-cover': {},
      './partner-import-photos': { publishPartnerPhotos: async () => [], removePartnerPrivatePhotos: async () => {} },
      './uploaded-photos': { deleteUploadedPhotos: async () => {} },
      './teacher-post-input': { extractTeacherPostFields },
      './photo': { defaultGradients: () => [], emojiFor: () => 'fixture' },
    });
    await api.publishReviewedPartnerDraft({
      id: 2, version: 1, postId: 3, sourceId: 4, reviewedRevision: 0,
      fields, photoCover: null, allPhotos: [], keepPhotos: [],
    });
    assert.equal(writes, 1);
    assert.equal(teacher.supportsCompensation, initial ?? false);
  }
});

const privateFields = ['phone', 'wechat', 'qq', 'otherContact', 'contact'];
const fixtureRows = [true, false].map((supportsCompensation, index) => ({
  id: index + 7, name: 'Synthetic teacher', type: '钢琴', city: '上海市', district: '上海市',
  price: '', services: 'Synthetic services', courseNotes: null, age: null,
  photos: '["fixture-cover","fixture-detail"]', emoji: 'fixture', address: null,
  createdAt: new Date('2026-01-01T00:00:00Z'), supportsCompensation,
  isNationallyPromoted: false, promotionOrder: 100, promotionStartsAt: null, promotionEndsAt: null,
  phone: 'private-fixture-phone', wechat: 'private-fixture-wechat', qq: 'private-fixture-qq',
  otherContact: 'private-fixture-other',
}));

function teachers() {
  const selects = [];
  const selectRow = (row, select) => {
    assert.ok(select, 'Public teacher queries must use an explicit select');
    selects.push(plain(select));
    return Object.fromEntries(Object.keys(select).filter(key => select[key] === true).map(key => [key, row[key]]));
  };
  const api = load('src/lib/teachers.ts', {
    './prisma': { prisma: { teacher: {
      count: async () => fixtureRows.length,
      findMany: async ({ select }) => fixtureRows.map(row => selectRow(row, select)),
      findUnique: async ({ where, select }) => {
        const row = fixtureRows.find(item => item.id === where.id);
        return row ? (select ? selectRow(row, select) : { ...row }) : null;
      },
      groupBy: async () => [{ type: '钢琴', _count: { _all: fixtureRows.length } }],
      aggregate: async () => ({ _max: { createdAt: fixtureRows[0].createdAt } }),
    } } },
    react: { cache: fn => fn },
    '@/data/locations': { normalizeLocationName: value => value },
    '@/lib/location-seo': {},
    '@/lib/site-config': { MIN_ACCESSIBLE_LOCATION_RECORDS: 1 },
  });
  return { api, selects };
}

function assertPublicCompensation(result, selects) {
  assert.deepEqual(Array.from(result, row => row.supportsCompensation), [true, false]);
  assert.ok(selects.length > 0);
  for (const select of selects) {
    assert.equal(select.supportsCompensation, true);
    for (const field of privateFields) assert.equal(Object.hasOwn(select, field), false, field);
  }
  for (const row of result) {
    for (const field of privateFields) assert.equal(Object.hasOwn(row, field), false, field);
  }
  assert.doesNotMatch(JSON.stringify(result), /private-fixture/);
}

test('homepage cards carry compensation status without querying contact details', async () => {
  const { api, selects } = teachers();
  const result = await api.getHomeTeachers(1, 10);
  assertPublicCompensation(result.teachers, selects);
});

test('national promotion cards carry compensation status without querying contact details', async () => {
  const { api, selects } = teachers();
  assertPublicCompensation(await api.getActiveNationalPromotions(), selects);
});

test('location cards carry compensation status without querying contact details', async () => {
  const { api, selects } = teachers();
  const result = await api.getTeachersForSeoLocation('上海市', undefined, 1, 10);
  assertPublicCompensation(result.teachers, selects);
});

test('public detail and administrator record mapping preserve both compensation states', async () => {
  const { api, selects } = teachers();
  const publicRows = await Promise.all(fixtureRows.map(row => api.getTeacherPublicById(String(row.id))));
  assertPublicCompensation(publicRows, selects);
  for (const row of fixtureRows) {
    assert.equal((await api.getTeacherById(String(row.id))).supportsCompensation, row.supportsCompensation);
  }
});

test('schema and migration leave all existing and newly inserted teachers uncompensated by default', () => {
  const teacherModel = read('prisma/schema.prisma').match(/model Teacher\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(teacherModel, 'Teacher model must exist');
  assert.match(teacherModel, /\bsupportsCompensation\s+Boolean\s+@default\(false\)/);
  const directory = new URL('../prisma/migrations/', import.meta.url);
  const migrations = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => read(`prisma/migrations/${entry.name}/migration.sql`))
    .filter(sql => /supportsCompensation/.test(sql));
  assert.equal(migrations.length, 1, 'The compensation flag needs one additive migration');
  assert.match(migrations[0], /ALTER TABLE\s+"Teacher"\s+ADD COLUMN\s+"supportsCompensation"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false\s*;/i);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE "Teacher" (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO "Teacher" (id, name) VALUES (?, ?)').run(1, 'Existing synthetic teacher');
    db.exec(migrations[0]);
    db.prepare('INSERT INTO "Teacher" (id, name) VALUES (?, ?)').run(2, 'New synthetic teacher');
    const rows = () => db.prepare('SELECT id, name, supportsCompensation FROM "Teacher" ORDER BY id').all();
    assert.deepEqual(rows().map(row => row.supportsCompensation), [0, 0]);
    assert.equal(rows()[0].name, 'Existing synthetic teacher');
    db.prepare('UPDATE "Teacher" SET supportsCompensation = ? WHERE id = ?').run(1, 1);
    assert.deepEqual(rows().map(row => row.supportsCompensation), [1, 0]);
    db.prepare('UPDATE "Teacher" SET supportsCompensation = ? WHERE id = ?').run(0, 1);
    assert.deepEqual(rows().map(row => row.supportsCompensation), [0, 0]);
  } finally {
    db.close();
  }
});
