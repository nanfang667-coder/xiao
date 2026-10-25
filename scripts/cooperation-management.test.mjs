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
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URLSearchParams, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const filtersApi = load('src/lib/cooperation-filters.ts');
const { parseCooperationFilters: parse, cooperationHref: href } = filtersApi;
const returns = load('src/lib/admin-teacher-return.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const photoKey = '00000000-0000-0000-0000-000000000001.jpg';

// In-memory fixtures only: no environment files, live databases, or external requests.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => matches(row, condition));
    if (key === 'OR') return value.some(condition => matches(row, condition));
    if (key === 'NOT') return !matches(row, value);
    if (value && typeof value === 'object') {
      if ('contains' in value) return row[key]?.includes(value.contains) ?? false;
      if ('startsWith' in value) return row[key]?.startsWith(value.startsWith) ?? false;
      if ('in' in value) return value.in.includes(row[key]);
      return matches(row[key], value);
    }
    return row[key] === value;
  });
}

function order(rows, orderBy = []) {
  return [...rows].sort((a, b) => {
    for (const rule of orderBy) {
      const [key, direction] = Object.entries(rule)[0];
      if (typeof direction === 'object') {
        const nested = order([a[key], b[key]], [direction]);
        if (a[key].createdAt.getTime() !== b[key].createdAt.getTime()) return nested[0] === a[key] ? -1 : 1;
      } else {
        const delta = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
        if (delta) return direction === 'desc' ? -delta : delta;
      }
    }
    return 0;
  });
}

function pick(row, select) {
  if (!select || row == null) return row;
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key,
    value === true ? row[key] : Array.isArray(row[key])
      ? order(row[key].filter(item => matches(item, value.where)), value.orderBy).slice(0, value.take).map(item => pick(item, value.select))
      : pick(row[key], value.select),
  ]));
}

function fixture({ authorized = true, ready = true, imported = false, draft = {} } = {}) {
  const accountA = { id: 1, username: '测试甲', isActive: true };
  const accountB = { id: 2, username: '测试乙', isActive: false };
  const date = id => new Date(Date.UTC(2026, 8, 1, 0, id));
  const post = (id, teamAccountId, extra = {}) => ({
    id, teamAccountId, account: teamAccountId === 1 ? accountA : accountB,
    status: 'pending', kind: 'create', teacherId: null, submissionKey: null, partnerImportDraftId: null,
    name: `模拟帖子${id}`, city: '广东省', district: '广州市', price: '100', emoji: '🎹',
    photos: '[]', age: '25', services: '测试服务', courseNotes: null, phone: '测试联系方式', wechat: '', qq: null,
    otherContact: null, address: null, createdAt: date(id), reviewedAt: null, reviewNote: null,
    ...extra,
  });
  const submissions = [
    ...Array.from({ length: 25 }, (_, i) => post(i + 1, 1)),
    post(100, 2),
    post(101, 1, { status: 'approved', teacherId: 201, reviewedAt: date(101) }),
    post(102, 1, { status: 'approved', kind: 'update', teacherId: 201, reviewedAt: date(102) }),
    post(103, 1, { status: 'rejected', district: '深圳市', reviewedAt: date(103), reviewNote: '资料不足' }),
  ];
  if (imported) Object.assign(submissions[0], {
    submissionKey: 'partner-import:77', partnerImportDraftId: 77,
    partnerImportDraft: { id: 77, version: 4, status: 'submitted', teamAccountId: 1, photos: JSON.stringify([photoKey]), ...draft },
  });
  const ownerships = [201, 202, 203].map((id, index) => ({
    teacherId: id, teamAccountId: index === 2 ? 2 : 1,
    account: index === 2 ? accountB : accountA,
    teacher: { ...post(id, index === 2 ? 2 : 1), name: `在线帖子${id}`, viewCount: 10 },
  }));
  const accounts = [accountB, accountA, ...Array.from({ length: 8 }, (_, i) => ({ id: i + 3, username: `空账号${i}`, isActive: true }))].map(account => ({
    ...account,
    passwordHash: 'PRIVATE_TEST_SENTINEL',
    _count: {
      teacherOwnerships: ownerships.filter(row => row.teamAccountId === account.id).length,
      submissions: submissions.filter(row => row.teamAccountId === account.id && row.status === 'pending').length,
    },
    submissions: submissions.filter(row => row.teamAccountId === account.id),
  }));
  const calls = [];
  function model(rows, name) {
    return {
      count: async ({ where }) => { calls.push([name, 'count', where]); return rows.filter(row => matches(row, where)).length; },
      findMany: async args => {
        calls.push([name, 'findMany', args]);
        if (name === 'submissions') {
          assert.equal(Object.hasOwn(args.select, 'partnerImportDraft'), false);
          assert.equal(Object.hasOwn(args.select, 'importReview'), false);
        }
        if (!ready && name === 'submissions') {
          assert.equal(Object.hasOwn(args.select, 'partnerImportDraftId'), false);
          assert.equal(Object.hasOwn(args.select, 'partnerImportDraft'), false);
        }
        const selected = order(rows.filter(row => matches(row, args.where)), args.orderBy);
        return selected.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take).map(row => pick(name === 'accounts' ? {
          ...row, _count: { ...row._count, submissions: row.submissions.filter(item => matches(item, args.select._count.select.submissions.where)).length },
        } : row, args.select));
      },
      findUnique: async ({ where, select }) => {
        calls.push([name, 'findUnique', where]);
        const row = rows.find(row => matches(row, where));
        return row ? pick(row, select) : null;
      },
    };
  }
  const api = load('src/lib/admin-cooperation.ts', {
    'server-only': {}, '@/lib/cooperation-filters': filtersApi,
    '@/lib/ordinary-submission-boundary': { getOrdinarySubmissionBoundary: async () => ({
      hasImportReference: ready, where: { ...filtersApi.ORDINARY_SUBMISSION_WHERE, ...(ready ? { partnerImportDraftId: null } : {}) },
    }) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/prisma': { prisma: {
      teamAccount: model(accounts, 'accounts'), teacherSubmission: model(submissions, 'submissions'), teacherOwnership: model(ownerships, 'ownerships'),
    } },
  });
  return { api, calls, submissions };
}

test('unauthenticated requests cannot read any account or post data', async () => {
  const { api, calls } = fixture({ authorized: false });
  await assert.rejects(api.getCooperationManagement(parse({})), /UNAUTHORIZED/);
  assert.equal(calls.length, 0);
});

test('pending posts stay in their account with stable database pagination', async () => {
  const { api, calls } = fixture();
  const first = await api.getCooperationManagement(parse({ account: '1' }));
  assert.equal(first.pagination.total, 25);
  assert.equal(first.submissions.length, 20);
  assert.ok(first.submissions.every(row => row.teamAccountId === 1 && row.status === 'pending'));
  assert.equal(first.submissions[0].id, 1);
  assert.equal(first.submissions.at(-1).id, 20);
  const last = await api.getCooperationManagement(parse({ account: '1', page: '999' }));
  assert.equal(last.pagination.page, 2);
  assert.deepEqual(clone(last.submissions.map(row => row.id)), [21, 22, 23, 24, 25]);
  assert.ok(calls.filter(([model, method]) => model === 'submissions' && method === 'findMany').every(([, , args]) => args.take === 20));
  assert.equal(JSON.stringify(first).includes('PRIVATE_TEST_SENTINEL'), false);
});

test('account summaries prioritize pending work and paginate independently', async () => {
  const { api } = fixture();
  const result = await api.getCooperationManagement(parse({ accountPage: '1' }));
  assert.equal(result.accounts.length, 8);
  assert.equal(result.accounts[0].id, 1);
  assert.equal(result.accounts[0]._count.submissions, 25);
  assert.equal(result.accounts[0]._count.teacherOwnerships, 2);
  assert.equal(result.accounts[1].isActive, false);
  const searched = await api.getCooperationManagement(parse({ accountQ: '测试乙', account: '1' }));
  assert.deepEqual(clone(searched.accounts.map(row => row.id)), [2]);
  assert.equal(searched.selectedAccount.id, 1);
  assert.equal(searched.pagination.total, 25);
});

test('published posts come from ownerships, not duplicated review history', async () => {
  const { api } = fixture();
  const result = await api.getCooperationManagement(parse({ account: '1', view: 'published' }));
  assert.equal(result.counts.published, 2);
  assert.equal(result.counts.history, 3);
  assert.equal(result.ownerships.length, 2);
  assert.equal(result.submissions.length, 0);
  assert.ok(result.ownerships.every(row => row.teamAccountId === 1));
  const searched = await api.getCooperationManagement(parse({ account: '1', view: 'published', q: '#201', region: '广州' }));
  assert.equal(searched.pagination.total, 1);
  assert.equal(searched.ownerships[0].teacher.id, 201);
});

test('history combines result, region, title and post ID filters without returning pending work', async () => {
  const { api } = fixture();
  const rejected = await api.getCooperationManagement(parse({ account: '1', view: 'history', status: 'rejected', region: '深圳' }));
  assert.equal(rejected.submissions.length, 1);
  assert.equal(rejected.submissions[0].reviewNote, '资料不足');
  const approved = await api.getCooperationManagement(parse({ account: '1', view: 'history', q: '201' }));
  assert.deepEqual(clone(approved.submissions.map(row => row.id)), [102, 101]);
  const title = await api.getCooperationManagement(parse({ account: '1', q: '模拟帖子25', region: '广东' }));
  assert.equal(title.submissions[0].id, 25);
});

test('malformed and missing accounts never widen to all accounts', async () => {
  const { api } = fixture();
  for (const account of ['0', '-1', 'NaN', '999', '9007199254740992']) {
    const result = await api.getCooperationManagement(parse({ account }));
    assert.equal(result.selectedAccount, null);
    assert.equal(result.pagination.total, 0);
    assert.equal(result.counts.pending, 0);
  }
});

test('filter URLs preserve account and search state, while tab changes reset the post page', () => {
  const filters = parse({ account: ['2', '1'], page: '3', accountQ: '甲&乙', accountPage: '2', view: 'history', status: 'rejected', q: '#8', region: '广东' });
  assert.deepEqual(clone(parse(Object.fromEntries(new URL(href(filters), 'https://example.test').searchParams))), clone(filters));
  const next = parse(Object.fromEntries(new URL(href(filters, { view: 'published', page: 1 }), 'https://example.test').searchParams));
  assert.equal(next.accountId, 2);
  assert.equal(next.query, '#8');
  assert.equal(next.page, 1);
  assert.equal(next.historyStatus, '');
  assert.equal(parse({ page: '-2', view: 'invalid', q: 'x'.repeat(120) }).query.length, 100);
});

test('edit return URLs only allow the two admin list pages', () => {
  const allowed = '/adminzhangzhang/submissions?account=1&view=published&page=2';
  assert.equal(returns.adminTeacherReturnTo(allowed), allowed);
  for (const value of [undefined, 'https://evil.test', '//evil.test', '/adminzhangzhang/teachers/../login', '/adminzhangzhang/submissions?x=\n']) {
    assert.equal(returns.adminTeacherReturnTo(value), '/adminzhangzhang/teachers');
  }
});

async function renderPage(params, options, inspect = () => {}) {
  const { api } = fixture(options);
  const { default: Page } = load('src/app/adminzhangzhang/submissions/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/admin-cooperation': api, '@/lib/cooperation-filters': filtersApi,
    '@/lib/photo': { isImage: () => false },
    '../DeleteTeacherButton': { DeleteTeacherButton: () => React.createElement('button', null, '删除') },
    './actions': { approveTeacherSubmission: async () => {}, rejectTeacherSubmission: async () => {} },
  });
  const tree = await Page({ searchParams: Promise.resolve(params) });
  inspect(tree);
  return renderToStaticMarkup(tree);
}

test('UI keeps account links and filters, with review controls only in pending view', async () => {
  const pending = await renderPage({ account: '1', q: '模拟帖子25' });
  assert.match(pending, /合作帖子管理/);
  assert.match(pending, /展开投稿详情/);
  assert.match(pending, /审核通过/);
  assert.match(pending, /name="account" value="1"/);
  const published = await renderPage({ account: '1', view: 'published' });
  assert.match(published, /在线帖子201/);
  assert.match(published, /returnTo=.*account%3D1/);
  assert.doesNotMatch(published, /审核通过|在线帖子203/);
  const history = await renderPage({ account: '1', view: 'history', status: 'rejected' });
  assert.match(history, /资料不足/);
  assert.doesNotMatch(history, /name="reviewNote"/);
  const empty = await renderPage({ account: '999' });
  assert.match(empty, /账号不存在/);
  assert.match(empty, /当前条件下没有待审核内容/);
});

test('historical imported submissions are excluded from queues, totals and account summaries', async () => {
  for (const ready of [false, true]) {
    const f = fixture({ ready, imported: true });
    const result = await f.api.getCooperationManagement(parse({ account: '1' }));
    assert.equal(result.pagination.total, 24);
    assert.equal(result.counts.pending, 24);
    assert.equal(result.accounts.find(row => row.id === 1)._count.submissions, 24);
    assert.equal(result.submissions[0].id, 2);
    assert.ok(result.submissions.every(row => !Object.hasOwn(row, 'submissionKey')
      && !Object.hasOwn(row, 'partnerImportDraftId') && !Object.hasOwn(row, 'isPartnerImport')));
    const imported = await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }));
    assert.equal(imported.submissions.length, 0);
    f.submissions[0].status = 'approved';
    const history = await f.api.getCooperationManagement(parse({ account: '1', view: 'history', q: '#1' }));
    assert.equal(history.submissions.length, 0);
  }
});

test('draft references without a reserved key also cannot enter ordinary review', async () => {
  const f = fixture({ imported: true });
  f.submissions[0].submissionKey = null;
  const result = await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }));
  assert.equal(result.submissions.length, 0);
  assert.equal(result.counts.pending, 24);
});

test('historical private draft content is never inspected or exposed', async () => {
  const f = fixture({ imported: true });
  f.submissions[0].partnerImportDraft = new Proxy({}, { get() { throw new Error('PRIVATE_DRAFT_MUST_NOT_BE_READ'); } });
  const result = await f.api.getCooperationManagement(parse({ account: '1' }));
  assert.equal(JSON.stringify(result).includes(photoKey), false);
});

test('ordinary cards keep review controls while old import records have no cards or workflow notices', async () => {
  const ordinary = await renderPage({ account: '1', q: '#1' });
  assert.match(ordinary, />审核通过</);
  assert.match(ordinary, />不通过</);
  assert.match(ordinary, /name="reviewNote"/);
  const imported = await renderPage({ account: '1', q: '#1' }, { imported: true });
  assert.match(imported, /当前条件下没有待审核内容/);
  assert.doesNotMatch(imported, /历史导入稿|已停止流转|获取网站图片|name="reviewNote"|终审|data-import-review/);
});
