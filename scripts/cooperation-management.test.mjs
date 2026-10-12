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
const photoApi = load('src/lib/partner-import-photos.ts', Object.fromEntries([
  'node:crypto', 'node:fs/promises', 'node:path', 'node:fs', './image-upload',
  './partner-import-fetch', './partner-import-photo-cover', './partner-import-photo-cover-render',
].map(name => [name, {}])));

// In-memory fixtures only: no environment files, live databases, or external requests.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => matches(row, condition));
    if (key === 'OR') return value.some(condition => matches(row, condition));
    if (value && typeof value === 'object') {
      if ('contains' in value) return row[key].includes(value.contains);
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
    status: 'pending', kind: 'create', teacherId: null,
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
        if (!ready && name === 'submissions') {
          assert.equal(Object.hasOwn(args.select, 'partnerImportDraftId'), false);
          assert.equal(Object.hasOwn(args.select, 'partnerImportDraft'), false);
        }
        const selected = order(rows.filter(row => matches(row, args.where)), args.orderBy);
        return selected.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take).map(row => pick(row, args.select));
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
    '@/lib/partner-import-photos': photoApi,
    '@/lib/partner-import-assignment-readiness': { isPartnerImportAssignmentReady: async () => ready },
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
    './InlineImportReview': { InlineImportReview: ({ submissionId, draftId, version }) => React.createElement('div', {
      'data-import-review': submissionId + ':' + draftId + ':' + version,
    }, '审核通过并发布') },
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

test('old-schema cooperation lists omit new columns and still distinguish import submissions by their old key', async () => {
  for (const imported of [false, true]) {
    const f = fixture({ ready: false, imported });
    const result = await f.api.getCooperationManagement(parse({ account: '1' }));
    assert.equal(result.assignmentReady, false);
    assert.equal(result.submissions.length, 20);
    assert.equal(result.submissions[0].isPartnerImport, imported);
    assert.equal(result.submissions[0].partnerImportDraftId, null);
    assert.equal(Object.hasOwn(result.submissions[0], 'submissionKey'), false);
    assert.equal(f.calls.filter(([model, method]) => model === 'submissions' && method === 'findMany')
      .every(([, , args]) => !Object.hasOwn(args.select, 'partnerImportDraftId')), true);
  }
});

test('unavailable assignment UI preserves ordinary controls and blocks imported-submission shortcuts', async () => {
  const ordinary = await renderPage({ account: '1', q: '#1' }, { ready: false });
  assert.match(ordinary, /团队分配功能尚未启用/);
  assert.match(ordinary, /审核通过/);
  const imported = await renderPage({ account: '1', q: '#1' }, { ready: false, imported: true });
  assert.match(imported, /此稿件需要导入终审/);
  assert.doesNotMatch(imported, /name="reviewNote"|打开导入稿终审|>审核通过</);
});


test('import review selects only bounded private photo metadata and binds the submitted version', async () => {
  const f = fixture({ imported: true });
  const result = await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }));
  const row = result.submissions[0];
  assert.deepEqual(clone(row.importReview), { draftId: 77, version: 4, photos: [photoKey] });
  assert.equal(row.age, '25');
  assert.equal(Object.hasOwn(row, 'partnerImportDraft'), false);
  assert.equal(Object.hasOwn(row, 'submissionKey'), false);
  const query = f.calls.find(([model, method]) => model === 'submissions' && method === 'findMany')[2];
  assert.deepEqual(clone(query.select.partnerImportDraft.select), { id: true, version: true, status: true, teamAccountId: true, photos: true });
});

test('historical and ordinary submissions do not expose an inline import review', async () => {
  const ordinary = fixture();
  const pending = await ordinary.api.getCooperationManagement(parse({ account: '1' }));
  assert.ok(pending.submissions.every(row => row.importReview === null));
  const f = fixture({ imported: true });
  f.submissions[0].status = 'approved';
  const history = await f.api.getCooperationManagement(parse({ account: '1', view: 'history' }));
  assert.ok(history.submissions.every(row => row.importReview === null));
  const query = f.calls.find(([model, method]) => model === 'submissions' && method === 'findMany')[2];
  assert.equal(Object.hasOwn(query.select, 'partnerImportDraft'), false);
});

test('inconsistent submission and draft ownership or state cannot get inline publication controls', async () => {
  for (const draft of [{ status: 'returned' }, { teamAccountId: 2 }, { id: 78 }]) {
    const f = fixture({ imported: true, draft });
    const result = await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }));
    assert.equal(result.submissions[0].importReview, null);
  }
  const f = fixture({ imported: true });
  f.submissions[0].kind = 'update';
  assert.equal((await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }))).submissions[0].importReview, null);
});

test('unsafe or invalid photo records fail closed while legitimate empty photos remain reviewable', async () => {
  for (const photos of ['invalid', '["https://example.test/photo.jpg"]', '["../secret.jpg"]', '{}']) {
    const f = fixture({ imported: true, draft: { photos } });
    const result = await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }));
    assert.equal(result.submissions[0].importReview.photos, null);
  }
  const f = fixture({ imported: true, draft: { photos: '[]' } });
  assert.deepEqual(clone((await f.api.getCooperationManagement(parse({ account: '1', q: '#1' }))).submissions[0].importReview.photos), []);
});

test('pending imported cards offer inline final review and all text fields without ordinary approval shortcuts', async () => {
  const page = await renderPage({ account: '1', q: '#1' }, { imported: true });
  assert.match(page, /data-import-review="1:77:4"/);
  assert.match(page, /审核通过并发布/);
  assert.match(page, /年龄：25/);
  assert.match(page, /打开导入稿终审/);
  assert.doesNotMatch(page, /name="reviewNote"|>审核通过<|PRIVATE_TEST_SENTINEL/);
  const stale = await renderPage({ account: '1', q: '#1' }, { imported: true, draft: { status: 'returned' } });
  assert.match(stale, /稿件状态已变化/);
  assert.doesNotMatch(stale, /data-import-review/);
});


test('a resubmitted draft remounts inline photo and confirmation state for the new version', async () => {
  const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const keys = [];
  for (const version of [4, 5]) {
    await renderPage({ account: '1', q: '#1' }, { imported: true, draft: { version } }, tree => {
      const component = walk(tree).find(node => node.props?.draftId === 77);
      assert.ok(component);
      keys.push(component.key);
    });
  }
  assert.deepEqual(keys, ['1:77:4', '1:77:5']);
});
