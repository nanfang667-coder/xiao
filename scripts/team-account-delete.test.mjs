import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup({ authorized = true, fail = false } = {}) {
  const calls = [];
  const refreshed = [];
  const tx = Object.fromEntries(['teamSession', 'teacherSubmission', 'teacherOwnership', 'teamAccount'].map(name => [name, {
    deleteMany: async (args) => {
      calls.push([name, JSON.parse(JSON.stringify(args))]);
      if (fail && name === 'teacherSubmission') throw new Error('database failure');
    },
  }]));
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
