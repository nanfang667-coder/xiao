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

function actions({ authorized = true, activeSite = true } = {}) {
  const writes = [];
  const hashes = [];
  const refreshed = [];
  const api = load('src/app/adminzhangzhang/sites/actions.ts', {
    bcrypt: { default: { hash: async (password, cost) => { hashes.push([password, cost]); return 'test-hash'; } } },
    'next/cache': { revalidatePath: path => refreshed.push(path) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/team-post-quota': quota,
    '@/lib/partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => true },
    '@/lib/prisma': { prisma: {
      site: { findFirst: async ({ where }) => activeSite && where.id === 'fixture-site' && where.isActive ? { id: 'fixture-site' } : null },
      teamAccount: { create: async ({ data }) => writes.push(data) },
    } },
  });
  return { api, writes, hashes, refreshed };
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
  assert.equal(result.hashes.length, 0);
  const allowed = actions();
  for (const id of [0, -1, 1.5, NaN]) {
    await assert.rejects(allowed.api.resetTeamPassword(id, form(valid)), /Invalid team password/);
  }
  assert.equal(allowed.hashes.length, 0);
});

async function page({ authorized = true, sites = [{ id: 'fixture-site', name: '测试站', hostname: 'example.test' }] } = {}) {
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
            _count: { teacherOwnerships: 5 } }];
        },
      },
      teacherSubmission: { groupBy: async () => [{ teamAccountId: 7, _count: { _all: 3 } }] },
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
  assert.match(html, /name="siteId" value="fixture-site"/);
  assert.match(html, /account=7&amp;view=published/);
  assert.doesNotMatch(html, /新增网站|创建新网站|永久会员|单篇价格|保存本站设置/);
  await page({ authorized: false });
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
