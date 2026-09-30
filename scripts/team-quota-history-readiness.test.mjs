import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const names = ['id', 'teamAccountId', 'teamUsername', 'kind', 'delta', 'previousLimit', 'newLimit', 'legacyBonus', 'legacyMonth', 'createdAt'];
function fixture({ clientReady = true, columns = [...names], fail = false } = {}) {
  const calls = [];
  const prisma = {
    ...(clientReady ? { teamPostQuotaEvent: { fields: { teamUsername: {} } } } : {}),
    $queryRawUnsafe: async sql => {
      calls.push(sql);
      if (fail) throw new Error('PRIVATE_DATABASE_DIAGNOSTIC');
      return columns.map(name => ({ name }));
    },
  };
  const source = fs.readFileSync(new URL('../src/lib/team-quota-history-readiness.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === 'server-only') return {};
      assert.equal(name, './prisma');
      return { prisma };
    },
  });
  return { ...exports, calls, columns };
}

test('old clients and incomplete schemas cannot enable unlogged quota changes', async () => {
  const old = fixture({ clientReady: false });
  assert.equal(await old.isTeamQuotaHistoryReady(), false);
  assert.deepEqual(old.calls, []);
  for (const missing of names) {
    const f = fixture({ columns: names.filter(name => name !== missing) });
    await assert.rejects(f.requireTeamQuotaHistoryReady(), /额度记录尚未启用/);
  }
});

test('readiness checks only schema metadata and recognizes a subsequent upgrade', async () => {
  const f = fixture({ columns: [] });
  assert.equal(await f.isTeamQuotaHistoryReady(), false);
  f.columns.push(...names);
  await f.requireTeamQuotaHistoryReady();
  assert.deepEqual(f.calls, ['PRAGMA table_info("TeamPostQuotaEvent")', 'PRAGMA table_info("TeamPostQuotaEvent")']);
});

test('database diagnostics never reach the administrator response', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(f.requireTeamQuotaHistoryReady(), error => {
    assert.equal(error.message, f.TEAM_QUOTA_HISTORY_UNAVAILABLE);
    assert.doesNotMatch(error.message, /PRIVATE_DATABASE/);
    return true;
  });
});
