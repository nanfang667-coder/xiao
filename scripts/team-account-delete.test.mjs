import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup({ authorized = true, fail = false, ready = true, foreignKeyFailure = false } = {}) {
  const calls = [];
  const refreshed = [];
  const tx = Object.fromEntries(['teamSession', 'teacherSubmission', 'teacherOwnership', 'teamAccount'].map(name => [name, {
    deleteMany: async (args) => {
      calls.push([name, JSON.parse(JSON.stringify(args))]);
      if (fail && name === 'teacherSubmission') throw new Error('database failure');
      if (foreignKeyFailure && name === 'teamAccount') throw new Error('SYNTHETIC_FOREIGN_KEY');
    },
  }]));
  tx.partnerImportDraft = { updateMany: async args => { calls.push(['partnerImportDraft.updateMany', JSON.parse(JSON.stringify(args))]); } };
  const mocks = {
    'node:crypto': {}, bcrypt: {}, 'next/navigation': {},
    'next/cache': { revalidatePath: path => refreshed.push(path) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/prisma': { prisma: { $transaction: async callback => {
      calls.push('begin');
      try { await callback(tx); calls.push('commit'); }
      catch (error) { calls.push('rollback'); throw error; }
    } } },
    '@/lib/site-utils': {}, '@/lib/team-post-quota': {},
    '@/lib/partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => ready },
  };
  const source = fs.readFileSync(new URL('../src/app/adminzhangzhang/sites/actions.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require(name) { assert.ok(name in mocks, name); return mocks[name]; },
  });
  return { ...exports, calls, refreshed };
}

test('deletion requires admin and a valid account ID before any writes', async () => {
  const unauthorized = setup({ authorized: false });
  await assert.rejects(unauthorized.deleteTeamAccount(7), /UNAUTHORIZED/);
  assert.deepEqual(unauthorized.calls, []);
  const valid = setup();
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(valid.deleteTeamAccount(id), /Invalid team account/);
  }
  assert.deepEqual(valid.calls, []);
});

test('deletion removes only selected account relations in one transaction and keeps published posts', async () => {
  const api = setup();
  await api.deleteTeamAccount(7);
  assert.deepEqual(api.calls, ['begin',
    ['partnerImportDraft.updateMany', { where: { teamAccountId: 7, status: { in: ['assigned', 'returned', 'submitted'] } }, data: { teamAccountId: null, status: 'ready', version: { increment: 1 } } }],
    ['partnerImportDraft.updateMany', { where: { teamAccountId: 7 }, data: { teamAccountId: null, version: { increment: 1 } } }],
    ['teamSession', { where: { teamAccountId: 7 } }],
    ['teacherSubmission', { where: { teamAccountId: 7 } }],
    ['teacherOwnership', { where: { teamAccountId: 7 } }],
    ['teamAccount', { where: { id: 7 } }], 'commit']);
  assert.ok(api.refreshed.includes('/adminzhangzhang/sites'));
  assert.ok(api.refreshed.includes('/adminzhangzhang/submissions'));
  assert.ok(api.refreshed.includes('/team'));
});

test('failed relation cleanup aborts deletion and does not refresh as successful', async () => {
  const api = setup({ fail: true });
  await assert.rejects(api.deleteTeamAccount(7), /database failure/);
  assert.equal(api.calls.at(-1), 'rollback');
  assert.ok(!api.calls.some(call => Array.isArray(call) && call[0] === 'teamAccount'));
  assert.deepEqual(api.refreshed, []);
});

test('old-schema account deletion skips assignment fields and keeps the existing deletion transaction', async () => {
  const f = setup({ ready: false });
  await f.deleteTeamAccount(7);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'partnerImportDraft.updateMany'), false);
  assert.deepEqual(f.calls, ['begin',
    ['teamSession', { where: { teamAccountId: 7 } }],
    ['teacherSubmission', { where: { teamAccountId: 7 } }],
    ['teacherOwnership', { where: { teamAccountId: 7 } }],
    ['teamAccount', { where: { id: 7 } }], 'commit']);
});

test('old clients cannot delete accounts with migrated assignments when restrict ownership remains', async () => {
  const f = setup({ ready: false, foreignKeyFailure: true });
  await assert.rejects(f.deleteTeamAccount(7), /账号删除未完成/);
  assert.equal(f.calls.at(-1), 'rollback');
  assert.deepEqual(f.refreshed, []);
});
