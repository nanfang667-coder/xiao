import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ authorized = true, exists = true, fail = false } = {}) {
  const row = { id: 7, isPublished: true, name: '合成商家', photos: '["/synthetic.jpg"]',
    sortOrder: 4, viewCount: 12, phone: 'synthetic-contact', services: 'synthetic-service' };
  const calls = [], invalidations = [], writes = [];
  let photoOperations = 0;
  const mocks = {
    'next/cache': { revalidatePath: path => invalidations.push(path) },
    'next/navigation': { redirect() { throw new Error('REDIRECT'); } },
    '@/lib/auth': { requireAdmin: async () => {
      calls.push('auth');
      if (!authorized) throw new Error('UNAUTHORIZED');
    } },
    '@/lib/image-upload': {
      getSelectedPhotoFiles() { photoOperations++; return []; },
      saveUploadedPhotos: async () => { photoOperations++; return []; },
    },
    '@/lib/uploaded-photos': { deleteUploadedPhotos: async () => { photoOperations++; } },
    '@/lib/prisma': { prisma: { merchant: {
      updateMany: async args => {
        calls.push('updateMany');
        writes.push(plain(args));
        if (fail) throw new Error('synthetic private database diagnostic');
        if (!exists || args.where.id !== row.id) return { count: 0 };
        Object.assign(row, plain(args.data));
        return { count: 1 };
      },
      findUnique: async () => { calls.push('findUnique'); return { ...row }; },
      create: async ({ data }) => { calls.push('create'); writes.push(plain(data)); return { id: row.id }; },
      update: async ({ data }) => { calls.push('update'); writes.push(plain(data)); },
    } } },
  };
  const source = fs.readFileSync(new URL('../src/app/adminzhangzhang/merchants/actions.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), name);
    return mocks[name];
  } });
  return { api: exports, row, calls, invalidations, writes, photoOperations: () => photoOperations };
}

test('hide and restore update only the existing publication state and preserve merchant content and images', async () => {
  const f = fixture();
  const original = { ...f.row };
  for (const target of [false, true]) {
    assert.deepEqual(plain(await f.api.setMerchantVisibility(7, target)), {});
    assert.deepEqual(f.row, { ...original, isPublished: target });
    assert.deepEqual(f.writes.at(-1), { where: { id: 7 }, data: { isPublished: target } });
  }
  assert.deepEqual(f.calls, ['auth', 'updateMany', 'auth', 'updateMany']);
  assert.equal(f.photoOperations(), 0);
});

test('visibility changes invalidate the public list, detail, sitemap, admin list and edit form', async () => {
  const f = fixture();
  await f.api.setMerchantVisibility(7, false);
  assert.deepEqual(f.invalidations, [
    '/spa', '/adminzhangzhang', '/adminzhangzhang/merchants', '/sitemap.xml',
    '/spa/7', '/adminzhangzhang/merchants/7/edit',
  ]);
});

test('visibility actions authenticate before validation or mutation', async () => {
  const f = fixture({ authorized: false });
  await assert.rejects(f.api.setMerchantVisibility(7, false), /UNAUTHORIZED/);
  await assert.rejects(f.api.setMerchantVisibility(-1, 'false'), /UNAUTHORIZED/);
  assert.deepEqual(f.calls, ['auth', 'auth']);
  assert.equal(f.writes.length, 0);
  assert.equal(f.invalidations.length, 0);
  assert.equal(f.photoOperations(), 0);
});

test('invalid identifiers and non-boolean display states never reach the database', async () => {
  const f = fixture();
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7', null]) {
    assert.ok((await f.api.setMerchantVisibility(id, false)).error);
  }
  for (const value of ['false', 'true', 0, 1, null, undefined, {}, []]) {
    assert.ok((await f.api.setMerchantVisibility(7, value)).error);
  }
  assert.equal(f.writes.length, 0);
  assert.ok(f.calls.every(call => call === 'auth'));
  assert.equal(f.invalidations.length, 0);
});

test('missing merchants and database failures return safe feedback without deleting files or invalidating pages', async () => {
  for (const options of [{ exists: false }, { fail: true }]) {
    const f = fixture(options);
    const before = { ...f.row };
    const result = await f.api.setMerchantVisibility(7, false);
    assert.ok(result.error);
    assert.doesNotMatch(result.error, /private|database|diagnostic|synthetic/);
    assert.deepEqual(f.row, before);
    assert.equal(f.invalidations.length, 0);
    assert.equal(f.photoOperations(), 0);
  }
});

test('new and edit forms persist both visible and hidden choices through the same publication field', async () => {
  for (const [value, expected] of [['on', true], ['off', false]]) {
    const f = fixture();
    const form = new FormData();
    form.set('name', '合成商家');
    form.set('isPublished', value);
    await assert.rejects(f.api.createMerchant(form), /REDIRECT/);
    await assert.rejects(f.api.updateMerchant(7, form), /REDIRECT/);
    assert.equal(f.writes.length, 2);
    assert.equal(f.writes[0].isPublished, expected);
    assert.equal(f.writes[1].isPublished, expected);
    assert.equal(Object.hasOwn(f.writes[1], 'photos'), false);
    assert.equal(f.row.photos, '["/synthetic.jpg"]');
  }
});
