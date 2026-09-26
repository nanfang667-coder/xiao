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
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

function userActions() {
  return load('src/app/adminzhangzhang/users/UserActions.tsx', {
    'react/jsx-runtime': jsx,
    '../actions': { banUser() {}, unbanUser() {}, deleteUser() {} },
  });
}

const users = [
  { id: 101, username: 'active-member', isMember: true, isBanned: false },
  { id: 102, username: 'active-normal', isMember: false, isBanned: false },
  { id: 103, username: 'banned-member', isMember: true, isBanned: true },
  { id: 104, username: 'banned-normal', isMember: false, isBanned: true },
].map(user => ({
  ...user,
  email: `${user.username}@example.test`,
  createdAtLabel: '2026/09/01',
  expiryLabel: user.isMember ? '永久会员' : null,
  memberSinceLabel: user.isMember ? '2026/09/02' : null,
  bannedAtLabel: user.isBanned ? '2026/09/03' : null,
  banReason: user.isBanned ? '测试封禁原因' : null,
}));

function renderUsers(filter = 'all', search = '') {
  const state = [filter, search];
  const { UsersBrowser } = load('src/app/adminzhangzhang/users/UsersBrowser.tsx', {
    'react/jsx-runtime': jsx,
    react: { useState: () => [state.shift(), () => {}] },
    './UserActions': userActions(),
  });
  return renderToStaticMarkup(React.createElement(UsersBrowser, {
    users, siteVisitorStats: { today: 17, day: 23, month: 42, total: 101 },
  }));
}

test('user action components only expose account moderation and deletion', () => {
  assert.deepEqual(Object.keys(userActions()).sort(), [
    'BanUserButton', 'DeleteUserButton', 'UnbanUserButton',
  ]);
});

test('members and ordinary users keep moderation controls without membership mutations', () => {
  const html = renderUsers();
  assert.doesNotMatch(html, /开通会员|取消会员|name="days"|<select/);
  assert.equal((html.match(/>封禁<\/button>/g) ?? []).length, 2);
  assert.equal((html.match(/>解封<\/button>/g) ?? []).length, 2);
  assert.equal((html.match(/>删除<\/button>/g) ?? []).length, 4);
  assert.equal((html.match(/永久会员/g) ?? []).length, 2);
  assert.equal((html.match(/入会于 2026\/09\/02/g) ?? []).length, 2);
  assert.match(html, /全站独立访客/);
  for (const count of [17, 23, 42, 101]) assert.match(html, new RegExp(`>${count}</div>`));
});

test('historical membership filters, banned filter, and user search remain usable', () => {
  const member = renderUsers('member');
  assert.match(member, /active-member/);
  assert.match(member, /banned-member/);
  assert.doesNotMatch(member, /active-normal|banned-normal/);

  const normal = renderUsers('normal');
  assert.match(normal, /active-normal/);
  assert.match(normal, /banned-normal/);
  assert.doesNotMatch(normal, /active-member|banned-member|永久会员/);

  const banned = renderUsers('banned');
  assert.match(banned, /banned-member/);
  assert.match(banned, /banned-normal/);
  assert.doesNotMatch(banned, /active-member|active-normal/);

  const searched = renderUsers('all', '  ACTIVE-NORMAL@EXAMPLE.TEST  ');
  assert.match(searched, /active-normal/);
  assert.doesNotMatch(searched, /active-member|banned-member|banned-normal/);
});

function serverActions(authorized = true) {
  const calls = [];
  const refreshed = [];
  const record = (name, result) => async args => {
    calls.push([name, JSON.parse(JSON.stringify(args))]);
    return result;
  };
  const api = load('src/app/adminzhangzhang/actions.ts', {
    'fs/promises': {}, path: {}, 'next/headers': {}, 'next/navigation': {},
    'next/cache': { revalidatePath: route => refreshed.push(route) },
    '@/lib/auth': { requireAdmin: async () => {
      calls.push('authorize');
      if (!authorized) throw new Error('UNAUTHORIZED');
    } },
    '@/lib/prisma': { prisma: {
      user: { update: record('user.update'), updateMany: record('user.updateMany'), delete: record('user.delete') },
      order: { findMany: record('order.findMany', [{ id: 91 }]), deleteMany: record('order.deleteMany') },
      commission: { deleteMany: record('commission.deleteMany') },
      withdrawal: { deleteMany: record('withdrawal.deleteMany') },
    } },
    '@/lib/admin-teacher-return': {}, '@/lib/photo': {}, '@/lib/image-upload': {},
    '@/lib/admin-session': {}, '@/lib/admin-login-limit': {}, '@/lib/admin-login-limit-token': {},
    '@/lib/request-ip': {}, '@/lib/admin-session-token': {},
  });
  return { api, calls, refreshed };
}

test('membership server actions are removed and remaining user operations still require admin', async () => {
  const { api } = serverActions();
  assert.equal(Object.hasOwn(api, 'grantMembership'), false);
  assert.equal(Object.hasOwn(api, 'revokeMembership'), false);
  for (const operation of ['banUser', 'unbanUser', 'deleteUser']) {
    const denied = serverActions(false);
    await assert.rejects(denied.api[operation](101), /UNAUTHORIZED/);
    assert.deepEqual(denied.calls, ['authorize']);
    assert.deepEqual(denied.refreshed, []);
  }
});

test('authorized bans and unbans do not modify historical membership data', async () => {
  for (const [operation, isBanned] of [['banUser', true], ['unbanUser', false]]) {
    const { api, calls, refreshed } = serverActions();
    await api[operation](101);
    assert.equal(calls[0], 'authorize');
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0], 'user.update');
    assert.deepEqual(calls[1][1].where, { id: 101 });
    assert.equal(calls[1][1].data.isBanned, isBanned);
    assert.deepEqual(Object.keys(calls[1][1].data).sort(), ['banReason', 'bannedAt', 'isBanned']);
    assert.deepEqual(refreshed, ['/adminzhangzhang/users']);
  }
});

test('authorized user deletion still removes the chosen user and cleans historical relations', async () => {
  const { api, calls, refreshed } = serverActions();
  await api.deleteUser(101);
  assert.deepEqual(calls, [
    'authorize',
    ['order.findMany', { where: { userId: 101 }, select: { id: true } }],
    ['commission.deleteMany', { where: { OR: [{ referrerId: 101 }, { orderId: { in: [91] } }] } }],
    ['withdrawal.deleteMany', { where: { userId: 101 } }],
    ['order.deleteMany', { where: { userId: 101 } }],
    ['user.updateMany', { where: { referredBy: 101 }, data: { referredBy: null } }],
    ['user.delete', { where: { id: 101 } }],
  ]);
  assert.deepEqual(refreshed, ['/adminzhangzhang/users']);
});
