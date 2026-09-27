import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(file, mocks) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], 'Test loader must not repair invalid TypeScript syntax');
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const visitorStats = { today: 2, day: 8, month: 61, total: 400 };
const users = [
  { id: 701, username: 'zero-person', referralCode: 'ZERO-old', referralVisitorCount: 0, isMember: false, isBanned: false },
  { id: 702, username: 'boundary-person', referralCode: 'TEN-old', referralVisitorCount: 10, isMember: true, isBanned: false },
  { id: 703, username: 'eleven-person', referralCode: 'MixedCode-A', referralVisitorCount: 11, isMember: true, isBanned: false },
  { id: 704, username: 'largest-person', referralCode: 'MIXEDCODE-B', referralVisitorCount: 27, isMember: false, isBanned: true },
  { id: 705, username: 'middle-person', referralCode: 'THIRD-code', referralVisitorCount: 18, isMember: true, isBanned: true },
].map(user => ({
  ...user, email: null, createdAtLabel: '2026-08-01', expiryLabel: user.isMember ? '永久会员' : null,
  memberSinceLabel: user.isMember ? '2026-08-02' : null,
  bannedAtLabel: user.isBanned ? '2026-08-03' : null, banReason: null,
}));

const actions = load('src/app/adminzhangzhang/users/UserActions.tsx', {
  'react/jsx-runtime': jsx,
  '../actions': { banUser() {}, unbanUser() {}, deleteUser() {} },
});

function renderUsers({ filter = 'all', search = '', highOnly = false, records = users } = {}) {
  const state = [filter, search, highOnly];
  const { UsersBrowser } = load('src/app/adminzhangzhang/users/UsersBrowser.tsx', {
    'react/jsx-runtime': jsx,
    react: { useState: () => [state.shift(), () => {}] },
    './UserActions': actions,
  });
  return renderToStaticMarkup(React.createElement(UsersBrowser, { users: records, siteVisitorStats: visitorStats }));
}

function displayedIds(html) {
  return [...html.matchAll(/>#(\d+)<\/span>/g)].map(match => Number(match[1]));
}

function adminPage({ authorized = true } = {}) {
  const calls = [];
  let props;
  let authenticationChecked = false;
  const read = name => {
    assert.equal(authenticationChecked, true, name + ' ran before authorization');
    calls.push(name);
  };
  const rows = users.map(user => ({
    ...user,
    createdAt: new Date('2026-08-01T04:00:00Z'), membershipExpiresAt: null,
    memberSince: user.isMember ? new Date('2026-08-02T04:00:00Z') : null,
    bannedAt: user.isBanned ? new Date('2026-08-03T04:00:00Z') : null,
    passwordHash: 'SENSITIVE_HASH_FIXTURE', registrationIp: '192.0.2.1',
    referredBy: 999, _count: { referralVisits: user.referralVisitorCount },
  }));
  const Page = load('src/app/adminzhangzhang/users/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...attributes }) => React.createElement('a', attributes, children) },
    '@/lib/auth': { requireAdmin: async () => {
      calls.push('authorize');
      if (!authorized) throw new Error('UNAUTHORIZED');
      authenticationChecked = true;
    } },
    '@/lib/site-visitor-stats': {
      getTodayNewVisitorCount: async () => { read('today'); return visitorStats.today; },
      getLast24HourVisitorCount: async () => { read('day'); return visitorStats.day; },
    },
    '@/lib/prisma': { prisma: {
      user: { findMany: async query => {
        read('users');
        assert.equal(query.include._count.select.referralVisits, true);
        return rows;
      } },
      siteVisit: { count: async query => {
        read(query ? 'month' : 'total');
        return query ? visitorStats.month : visitorStats.total;
      } },
    } },
    './UsersBrowser': { UsersBrowser: supplied => { props = supplied; return null; } },
  }).default;
  return { Page, calls, get props() { return props; } };
}

test('admin loads existing per-code visitor totals and sends only safe display data to the client', async () => {
  const fixture = adminPage();
  renderToStaticMarkup(await fixture.Page());
  assert.equal(fixture.calls[0], 'authorize');
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.props.siteVisitorStats)), visitorStats);
  assert.deepEqual(Array.from(fixture.props.users, user => [user.referralCode, user.referralVisitorCount]),
    users.map(user => [user.referralCode, user.referralVisitorCount]));
  const allowedKeys = [
    'id', 'username', 'email', 'referralCode', 'referralVisitorCount', 'isMember',
    'createdAtLabel', 'expiryLabel', 'memberSinceLabel', 'isBanned', 'bannedAtLabel', 'banReason',
  ].sort();
  for (const user of fixture.props.users) assert.deepEqual(Object.keys(user).sort(), allowedKeys);
  assert.doesNotMatch(JSON.stringify(fixture.props), /SENSITIVE_HASH_FIXTURE|192\.0\.2\.1|password|registrationIp|referredBy|unlockRecords/);
});

test('unauthorized requests cannot query any user referral counts or site statistics', async () => {
  const fixture = adminPage({ authorized: false });
  await assert.rejects(fixture.Page(), /UNAUTHORIZED/);
  assert.deepEqual(fixture.calls, ['authorize']);
  assert.equal(fixture.props, undefined);
});

test('each existing invitation code displays its own visitor count including zero', () => {
  const html = renderUsers();
  assert.deepEqual(displayedIds(html), users.map(user => user.id));
  for (let index = 0; index < users.length; index++) {
    const user = users[index];
    const start = html.indexOf('>#' + user.id + '</span>');
    const end = users[index + 1] ? html.indexOf('>#' + users[index + 1].id + '</span>') : html.length;
    const card = html.slice(start, end);
    assert.ok(card.includes('邀请码 ' + user.referralCode));
    assert.match(card, new RegExp('独立访客 <strong>' + user.referralVisitorCount + '</strong> 人'));
  }
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /独立访客 &gt; 10/);
  assert.match(html, /3 个链接/);
});

test('invitation-code search trims whitespace, ignores case, and does not match unrelated users', () => {
  assert.deepEqual(displayedIds(renderUsers({ search: '  mixedCODE-a  ' })), [703]);
  assert.deepEqual(displayedIds(renderUsers({ search: 'mixedcode' })), [703, 704]);
  assert.deepEqual(displayedIds(renderUsers({ search: 'no-such-code' })), []);
});

test('high-visitor filter excludes exactly 10 and sorts larger totals descending without mutating input', () => {
  const originalOrder = users.map(user => user.id);
  const html = renderUsers({ highOnly: true });
  assert.deepEqual(displayedIds(html), [704, 705, 703]);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /人数从高到低/);
  assert.deepEqual(users.map(user => user.id), originalOrder);
  assert.deepEqual(displayedIds(renderUsers()), originalOrder);
});

test('high-visitor filter combines with membership, banned status, and invitation-code search', () => {
  assert.deepEqual(displayedIds(renderUsers({ highOnly: true, filter: 'member' })), [705, 703]);
  assert.deepEqual(displayedIds(renderUsers({ highOnly: true, filter: 'normal' })), [704]);
  assert.deepEqual(displayedIds(renderUsers({ highOnly: true, filter: 'banned' })), [704, 705]);
  assert.deepEqual(displayedIds(renderUsers({ highOnly: true, filter: 'banned', search: 'mixedCODE' })), [704]);
  assert.deepEqual(displayedIds(renderUsers({ highOnly: true, filter: 'member', search: 'TEN-old' })), []);
});

test('restoring referral statistics does not restore manual membership or payment features', () => {
  const html = renderUsers();
  assert.doesNotMatch(html, /开通会员|取消会员|单帖|支付金额|商户订单号|name="days"|<select/);
  assert.equal((html.match(/>封禁<\/button>/g) ?? []).length, 3);
  assert.equal((html.match(/>解封<\/button>/g) ?? []).length, 2);
  assert.equal((html.match(/>删除<\/button>/g) ?? []).length, 5);
  assert.match(html, /全站独立访客/);
  assert.match(html, /今日新增/);
  assert.match(html, /近24小时/);
});
