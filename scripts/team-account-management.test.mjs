import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, Buffer, URLSearchParams, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const quota = load('src/lib/team-post-quota.ts');
const pagination = load('src/lib/pagination.ts');
const form = values => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const valid = { username: ' Team_One ', password: 'test-password-long', monthlyPostLimit: '22', siteId: 'fixture-site' };

function actions({ authorized = true, activeSite = true, historyReady = true, failHistory = false, account = {
  id: 7, monthlyPostBonus: 25, monthlyPostBonusMonth: '2026-09',
} } = {}) {
  const writes = [];
  const updates = [];
  const hashes = [];
  const refreshed = [];
  const events = [];
  if (account) Object.assign(account, { username: 'fixture-team', monthlyPostLimit: 30, monthlyPostLimitOverride: 22, ...account });
  const teamAccount = {
    create: async ({ data }) => {
      writes.push(data);
      return { id: 8, monthlyPostBonus: 0, ...data };
    },
    findUnique: async ({ where }) => account?.id === where.id ? { ...account } : null,
    update: async ({ where, data }) => {
      assert.equal(account.id, where.id);
      Object.assign(account, data);
      return { ...account };
    },
    updateMany: async ({ where, data }) => {
      updates.push({ where, data });
      if (!account || where.id !== account.id || account.monthlyPostBonus < where.monthlyPostBonus.gte || account.monthlyPostBonus > where.monthlyPostBonus.lte) return { count: 0 };
      account.monthlyPostBonus += data.monthlyPostBonus.increment;
      return { count: 1 };
    },
  };
  const tx = {
    teamAccount,
    teamPostQuotaEvent: { create: async ({ data }) => {
      if (failHistory) throw new Error('HISTORY_WRITE_FAILED');
      events.push(JSON.parse(JSON.stringify(data)));
    } },
  };
  let queue = Promise.resolve();
  const transaction = callback => {
    const run = queue.then(async () => {
      const before = account && { ...account };
      const sizes = [writes.length, updates.length, events.length];
      try { return await callback(tx); }
      catch (error) {
        if (account) Object.assign(account, before);
        writes.length = sizes[0]; updates.length = sizes[1]; events.length = sizes[2];
        throw error;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
  const api = load('src/app/adminzhangzhang/sites/actions.ts', {
    bcrypt: { default: { hash: async (password, cost) => { hashes.push([password, cost]); return 'test-hash'; } } },
    'next/cache': { revalidatePath: path => refreshed.push(path) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/team-post-quota': quota,
    '@/lib/partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => true },
    '@/lib/team-quota-history-readiness': { requireTeamQuotaHistoryReady: async () => { if (!historyReady) throw new Error('HISTORY_UNAVAILABLE'); } },
    '@/lib/prisma': { prisma: {
      site: { findFirst: async ({ where }) => activeSite && where.id === 'fixture-site' && where.isActive ? { id: 'fixture-site' } : null },
      $transaction: transaction,
    } },
  });
  return { api, writes, updates, hashes, refreshed, account, events };
}

test('creating a team account normalizes username, hashes the password and preserves quota compatibility', async () => {
  for (const limit of ['22', '150']) {
    const result = actions();
    await result.api.createTeamAccount(form({ ...valid, monthlyPostLimit: limit }));
    assert.equal(result.writes[0].username, 'team_one');
    assert.equal(result.writes[0].passwordHash, 'test-hash');
    assert.equal(result.writes[0].monthlyPostLimit, limit === '22' ? 30 : 150);
    assert.equal(result.writes[0].monthlyPostLimitOverride, Number(limit));
    assert.deepEqual(result.hashes, [[valid.password, 12]]);
    assert.ok(result.refreshed.includes('/adminzhangzhang/submissions'));
    assert.deepEqual(result.events, [{ teamAccountId: 8, teamUsername: 'team_one', kind: 'account_created',
      delta: Number(limit), previousLimit: 0, newLimit: Number(limit) }]);
  }
});

test('invalid account input and unavailable sites cannot create or hash credentials', async () => {
  for (const override of [
    { username: 'x' }, { username: '<script>' }, { password: 'short' },
    { password: '密'.repeat(50) }, { monthlyPostLimit: '30' }, { siteId: 'missing' },
  ]) {
    const result = actions();
    await assert.rejects(result.api.createTeamAccount(form({ ...valid, ...override })), /Invalid/);
    assert.equal(result.writes.length, 0);
    assert.equal(result.hashes.length, 0);
  }
  const inactive = actions({ activeSite: false });
  await assert.rejects(inactive.api.createTeamAccount(form(valid)), /Invalid team site/);
  assert.equal(inactive.writes.length, 0);
});

test('team account actions require administrator authorization and valid reset IDs', async () => {
  const result = actions({ authorized: false });
  await assert.rejects(result.api.createTeamAccount(form(valid)), /UNAUTHORIZED/);
  await assert.rejects(result.api.resetTeamPassword(1, form(valid)), /UNAUTHORIZED/);
  await assert.rejects(result.api.deleteTeamAccount(1), /UNAUTHORIZED/);
  await assert.rejects(result.api.updateTeamMonthlyPostLimit(7, form(valid)), /UNAUTHORIZED/);
  await assert.rejects(result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })), /UNAUTHORIZED/);
  assert.equal(result.hashes.length, 0);
  assert.equal(result.updates.length, 0);
  const allowed = actions();
  for (const id of [0, -1, 1.5, NaN]) {
    await assert.rejects(allowed.api.resetTeamPassword(id, form(valid)), /Invalid team password/);
  }
  assert.equal(allowed.hashes.length, 0);
});

test('adding allowance accumulates existing grants from earlier months without changing month metadata', async () => {
  const result = actions();
  await result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' }));
  await result.api.addTeamMonthlyPostAllowance(7, form({ amount: '15' }));
  assert.equal(result.account.monthlyPostBonus, 50);
  assert.equal(result.account.monthlyPostBonusMonth, '2026-09');
  assert.equal(result.updates[0].data.monthlyPostBonus.increment, 10);
  assert.equal(result.updates[0].data.monthlyPostBonusMonth, undefined);
  assert.deepEqual(result.events, [
    { teamAccountId: 7, teamUsername: 'fixture-team', kind: 'allowance_added', delta: 10, previousLimit: 47, newLimit: 57 },
    { teamAccountId: 7, teamUsername: 'fixture-team', kind: 'allowance_added', delta: 15, previousLimit: 57, newLimit: 72 },
  ]);
  for (const path of ['/adminzhangzhang/sites', '/team', '/team/posts', '/team/posts/new']) {
    assert.ok(result.refreshed.includes(path));
  }
});

test('invalid allowance inputs and missing accounts do not change grants', async () => {
  for (const amount of ['', '0', '-1', '1.5', '1001', 'NaN', 'Infinity', 'abc']) {
    const result = actions();
    await assert.rejects(result.api.addTeamMonthlyPostAllowance(7, form({ amount })), /Invalid team post allowance/);
    assert.equal(result.updates.length, 0);
    assert.equal(result.account.monthlyPostBonus, 25);
  }
  for (const id of [0, -1, 1.5, NaN]) {
    const result = actions();
    await assert.rejects(result.api.addTeamMonthlyPostAllowance(id, form({ amount: '10' })), /Invalid team post allowance/);
    assert.equal(result.updates.length, 0);
  }
  const missing = actions({ account: null });
  await assert.rejects(missing.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })), /Team account not found/);
  assert.equal(missing.refreshed.length, 0);
});

test('concurrent allowance additions cannot exceed the accumulated grant cap', async () => {
  const result = actions({ account: { id: 7, monthlyPostBonus: 9990, monthlyPostBonusMonth: '2025-12' } });
  const outcomes = await Promise.allSettled([
    result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })),
    result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(outcome => outcome.status === 'rejected').reason.message, /allowance is too large/);
  assert.equal(result.account.monthlyPostBonus, 10000);
  assert.equal(result.account.monthlyPostBonusMonth, '2025-12');
  assert.equal(result.events.length, 1);
});

test('concurrent additions each record their exact resulting quota', async () => {
  const result = actions();
  await Promise.all([
    result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })),
    result.api.addTeamMonthlyPostAllowance(7, form({ amount: '15' })),
  ]);
  assert.deepEqual(result.events.map(event => [event.previousLimit, event.delta, event.newLimit]), [[47, 10, 57], [57, 15, 72]]);
});

test('invalid stored bonus cannot produce a misleading before/after audit record', async () => {
  const result = actions({ account: { id: 7, monthlyPostBonus: -3 } });
  await assert.rejects(result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })), /Team account not found or post allowance is too large/);
  assert.equal(result.account.monthlyPostBonus, -3);
  assert.equal(result.events.length, 0);
});

test('base changes record both increases and decreases while unchanged saves record nothing', async () => {
  const result = actions();
  await result.api.updateTeamMonthlyPostLimit(7, form({ monthlyPostLimit: '150' }));
  await result.api.updateTeamMonthlyPostLimit(7, form({ monthlyPostLimit: '150' }));
  await result.api.updateTeamMonthlyPostLimit(7, form({ monthlyPostLimit: '22' }));
  assert.deepEqual(result.events.map(event => [event.kind, event.delta, event.previousLimit, event.newLimit]), [
    ['base_changed', 128, 47, 175], ['base_changed', -128, 175, 47],
  ]);
});

test('missing history schema or failed event insertion cannot leave unlogged quota changes', async () => {
  for (const options of [{ historyReady: false }, { failHistory: true }]) {
    for (const operation of ['create', 'base', 'add']) {
      const result = actions(options);
      const before = { ...result.account };
      await assert.rejects(operation === 'create'
        ? result.api.createTeamAccount(form(valid))
        : operation === 'base'
          ? result.api.updateTeamMonthlyPostLimit(7, form({ monthlyPostLimit: '150' }))
          : result.api.addTeamMonthlyPostAllowance(7, form({ amount: '10' })), /HISTORY_/);
      assert.deepEqual(result.account, before);
      assert.equal(result.writes.length, 0);
      assert.equal(result.events.length, 0);
      assert.equal(result.refreshed.length, 0);
    }
  }
});

async function page({
  authorized = true,
  sites = [{ id: 'fixture-site', name: '测试站', hostname: 'example.test' }],
  account = {},
  used = 3,
} = {}) {
  let reads = 0;
  const { default: Page } = load('src/app/adminzhangzhang/sites/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/team-post-quota': quota, '@/lib/pagination': pagination,
    '@/lib/prisma': { prisma: {
      site: { findMany: async () => { reads++; return sites; } },
      teamAccount: {
        count: async () => { reads++; return 1; },
        findMany: async ({ select, take }) => {
          assert.equal(take, 20);
          assert.equal(select.passwordHash, undefined);
          return [{ id: 7, username: 'fixture-team', isActive: true, monthlyPostLimit: 30,
            monthlyPostLimitOverride: 22, monthlyPostBonus: 0, monthlyPostBonusMonth: null,
            _count: { teacherOwnerships: 5 }, ...account }];
        },
      },
      teacherSubmission: { groupBy: async ({ where }) => {
        assert.deepEqual(JSON.parse(JSON.stringify(where)), {
          kind: 'create', status: { in: ['pending', 'approved'] }, teamAccountId: { in: [7] },
        });
        return [{ teamAccountId: 7, _count: { _all: used } }];
      } },
    } },
    './actions': Object.fromEntries(['createTeamAccount', 'resetTeamPassword', 'updateTeamMonthlyPostLimit', 'addTeamMonthlyPostAllowance'].map(name => [name, async () => {}])),
    './DeleteTeamAccountButton': { DeleteTeamAccountButton: ({ accountId }) => React.createElement('button', { 'data-account': accountId }, '删除账号') },
  });
  if (!authorized) {
    await assert.rejects(Page({ searchParams: Promise.resolve({}) }), /UNAUTHORIZED/);
    assert.equal(reads, 0);
    return '';
  }
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

test('team page restores create/delete/password/quota controls without website or pricing forms', async () => {
  const html = await page();
  assert.match(html, /团队账号管理/);
  assert.match(html, /创建团队账号/);
  assert.match(html, /删除账号/);
  assert.match(html, /重设密码并启用/);
  assert.match(html, /保存额度/);
  assert.match(html, /累计已用 3\/22 条 · 剩余 19 条/);
  assert.match(html, /额度跨月保留，不会自动重置/);
  assert.match(html, /name="siteId" value="fixture-site"/);
  assert.match(html, /account=7&amp;view=published/);
  assert.doesNotMatch(html, /新增网站|创建新网站|永久会员|单篇价格|保存本站设置/);
  assert.doesNotMatch(html, /每月发帖|本月发帖|条\/月|本月增加/);
  await page({ authorized: false });
});

test('admin quota totals retain previous-month allowance and cumulative usage', async () => {
  const html = await page({ account: {
    monthlyPostLimit: 150, monthlyPostLimitOverride: 150,
    monthlyPostBonus: 25, monthlyPostBonusMonth: '2025-12',
  }, used: 100 });
  assert.match(html, /累计已用 100\/175 条 · 剩余 75 条（基础 150 \+ 追加 25）/);
  const exhausted = await page({ used: 30 });
  assert.match(exhausted, /累计已用 30\/22 条 · 剩余 0 条/);
});

test('multiple existing sites allow account assignment, while no active site disables account creation', async () => {
  const multi = await page({ sites: [
    { id: 'one', name: '测试一', hostname: 'one.test' },
    { id: 'two', name: '测试二', hostname: 'two.test' },
  ] });
  assert.match(multi, /账号所属站点/);
  assert.match(multi, /<select name="siteId"/);
  const empty = await page({ sites: [] });
  assert.match(empty, /当前没有可用站点/);
  assert.doesNotMatch(empty, /创建团队账号/);
});
