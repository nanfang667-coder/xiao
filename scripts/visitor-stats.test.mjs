import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const NOW = '2026-09-26T04:00:00.000Z';
const START = '2026-09-25T16:00:00.000Z';
const END = '2026-09-26T16:00:00.000Z';
const visits = [
  // An old visitor returning today is active, but not newly acquired.
  { firstVisitedAt: '2026-08-01T00:00:00Z', lastVisitedAt: NOW },
  { firstVisitedAt: '2026-09-25T15:59:59.999Z', lastVisitedAt: NOW },
  { firstVisitedAt: START, lastVisitedAt: NOW },
  { firstVisitedAt: '2026-09-26T15:59:59.999Z', lastVisitedAt: END },
  { firstVisitedAt: END, lastVisitedAt: END },
];

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return new Date(NOW).getTime(); }
}

function load(file, mocks, Clock = Date) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Date: Clock, require(name) {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

function countVisits(query, records = visits) {
  return records.filter((visit) => Object.entries(query?.where ?? {}).every(([field, range]) => {
    const time = new Date(visit[field]).getTime();
    return (range.gte === undefined || time >= range.gte.getTime())
      && (range.lt === undefined || time < range.lt.getTime());
  })).length;
}

function visitorHelper(count, Clock = Date) {
  return load('src/lib/site-visitor-stats.ts', {
    'server-only': {},
    '@/lib/prisma': { prisma: { siteVisit: { count } } },
    '@/lib/china-calendar': load('src/lib/china-calendar.ts', {}, Clock),
  }, Clock);
}

test('today counts first visits from Beijing midnight inclusive to next midnight exclusive', async () => {
  const queries = [];
  const { getTodayNewVisitorCount } = visitorHelper(async (query) => {
    queries.push(query);
    return countVisits(query);
  });
  assert.equal(await getTodayNewVisitorCount(new Date(NOW)), 2);
  assert.equal(queries.length, 1);
  assert.deepEqual(Object.keys(queries[0].where), ['firstVisitedAt']);
  assert.equal(queries[0].where.firstVisitedAt.gte.toISOString(), START);
  assert.equal(queries[0].where.firstVisitedAt.lt.toISOString(), END);
  assert.equal(countVisits({ where: { lastVisitedAt: { gte: new Date(START) } } }), 5);
});

test('today changes at Beijing midnight independently of UTC day boundaries', async () => {
  const queries = [];
  const { getTodayNewVisitorCount } = visitorHelper(async (query) => {
    queries.push(query);
    return countVisits(query);
  });
  assert.equal(await getTodayNewVisitorCount(new Date('2026-09-25T15:59:59.999Z')), 1);
  assert.equal(await getTodayNewVisitorCount(new Date(START)), 2);
  assert.equal(queries[0].where.firstVisitedAt.gte.toISOString(), '2026-09-24T16:00:00.000Z');
  assert.equal(queries[0].where.firstVisitedAt.lt.toISOString(), START);
  assert.equal(queries[1].where.firstVisitedAt.gte.toISOString(), START);
  assert.equal(queries[1].where.firstVisitedAt.lt.toISOString(), END);
});

test('last 24 hours includes returning visitors and exact cutoff, counting records rather than hits', async () => {
  const records = [
    { firstVisitedAt: '2026-08-01T00:00:00Z', lastVisitedAt: NOW, visitCount: 100 },
    { firstVisitedAt: '2026-08-02T00:00:00Z', lastVisitedAt: '2026-09-25T04:00:00.000Z', visitCount: 15 },
    { firstVisitedAt: '2026-08-03T00:00:00Z', lastVisitedAt: '2026-09-25T03:59:59.999Z', visitCount: 20 },
    { firstVisitedAt: START, lastVisitedAt: NOW, visitCount: 7 },
  ];
  const queries = [];
  const { getLast24HourVisitorCount } = visitorHelper(async (query) => {
    queries.push(query);
    return countVisits(query, records);
  });
  assert.equal(await getLast24HourVisitorCount(new Date(NOW)), 3);
  assert.equal(queries.length, 1);
  assert.deepEqual(Object.keys(queries[0].where), ['lastVisitedAt']);
  assert.deepEqual(Object.keys(queries[0].where.lastVisitedAt), ['gte']);
  assert.equal(queries[0].where.lastVisitedAt.gte.toISOString(), '2026-09-25T04:00:00.000Z');
});

function pages({ authorized = true } = {}) {
  let authenticationChecked = false;
  let reads = 0;
  let helperCalls = 0;
  let browserProps;
  const queries = [];
  const authenticatedRead = () => {
    assert.equal(authenticationChecked, true, 'Data must only be read after authentication');
    reads++;
  };
  const authenticate = async () => {
    if (!authorized) throw new Error('UNAUTHORIZED');
    authenticationChecked = true;
    return { id: 17, username: 'fixture-team', site: { name: '测试站点' } };
  };
  const prisma = {
    siteVisit: { count: async (query) => {
      authenticatedRead();
      queries.push(query);
      return countVisits(query);
    } },
    teacherOwnership: { count: async (query) => {
      authenticatedRead();
      assert.equal(query.where.teamAccountId, 17);
      return 7;
    } },
    teacher: { aggregate: async (query) => {
      authenticatedRead();
      assert.equal(query.where.ownership.teamAccountId, 17);
      assert.equal(query._sum.viewCount, true);
      return { _sum: { viewCount: 123 } };
    } },
    teacherSubmission: { count: async (query) => {
      authenticatedRead();
      assert.equal(query.where.teamAccountId, 17);
      return query.where.status === 'pending' ? 3 : 9;
    } },
    user: { findMany: async (query) => {
      authenticatedRead();
      assert.equal(query.include._count.select.referralVisits, true);
      return [{
        id: 21, username: 'fixture-user', email: null, referralCode: 'existing-code',
        _count: { referralVisits: 7 }, createdAt: new Date(START),
        isMember: false, membershipExpiresAt: null, memberSince: null,
        isBanned: false, bannedAt: null, banReason: null,
      }];
    } },
  };
  const actualHelper = visitorHelper(prisma.siteVisit.count, FixedDate);
  const common = {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/prisma': { prisma },
    '@/lib/site-visitor-stats': {
      getTodayNewVisitorCount: (...args) => {
        helperCalls++;
        return actualHelper.getTodayNewVisitorCount(...args);
      },
      getLast24HourVisitorCount: (...args) => {
        helperCalls++;
        return actualHelper.getLast24HourVisitorCount(...args);
      },
    },
  };
  const TeamPage = load('src/app/team/page.tsx', {
    ...common,
    '@/lib/team-auth': { requireTeamAccount: authenticate },
    '@/lib/team-post-quota': {
      getTeamPostUsageWhere: (teamAccountId) => ({ teamAccountId, fixtureQuota: true }),
      getEffectiveTeamPostLimit: () => 30,
      summarizeTeamPostQuota: (limit, used) => ({ limit, used, remaining: limit - used, exhausted: used >= limit }),
    },
    './actions': { teamLogout() {} },
  }, FixedDate).default;
  const AdminPage = load('src/app/adminzhangzhang/users/page.tsx', {
    ...common,
    '@/lib/auth': { requireAdmin: authenticate },
    './UsersBrowser': { UsersBrowser: (props) => { browserProps = props; return null; } },
  }, FixedDate).default;
  return {
    TeamPage, AdminPage, queries,
    get reads() { return reads; },
    get helperCalls() { return helperCalls; },
    get browserProps() { return browserProps; },
  };
}

test('team and user management share today and last 24 hour counts while keeping post statistics', async () => {
  const fixture = pages();
  const teamHtml = renderToStaticMarkup(await fixture.TeamPage());
  renderToStaticMarkup(await fixture.AdminPage());
  assert.equal(fixture.helperCalls, 4);
  assert.equal(fixture.browserProps.users[0].referralCode, 'existing-code');
  assert.equal(fixture.browserProps.users[0].referralVisitorCount, 7);
  assert.equal(fixture.browserProps.siteVisitorStats.today, 2);
  assert.equal(fixture.browserProps.siteVisitorStats.total, visits.length);
  assert.equal(fixture.browserProps.siteVisitorStats.day, 5);
  assert.equal(fixture.browserProps.siteVisitorStats.month, 5);
  for (const [label, value] of [
    ['今日新增', 2], ['近24小时访问量', fixture.browserProps.siteVisitorStats.day], ['全站累计独立访客', 5], ['我的已发布帖子', 7],
    ['我的帖子总浏览次数', 123], ['待管理员审核', 3],
  ]) {
    assert.match(teamHtml, new RegExp(label + '</p><p[^>]*>' + value + '</p>'));
  }
  assert.ok(teamHtml.indexOf('今日新增') < teamHtml.indexOf('近24小时访问量'));
  assert.ok(teamHtml.indexOf('近24小时访问量') < teamHtml.indexOf('全站累计独立访客'));
  assert.ok(teamHtml.includes('已用 9/30 条，剩余 21 条'));
  assert.ok(teamHtml.includes('href="/team/posts"'));
  assert.ok(teamHtml.includes('href="/team/posts/new"'));
  const recentQueries = fixture.queries.filter((query) => query?.where?.lastVisitedAt);
  assert.deepEqual(recentQueries.map((query) => query.where.lastVisitedAt.gte.toISOString()), [
    '2026-09-25T04:00:00.000Z', '2026-09-25T04:00:00.000Z', '2026-08-27T04:00:00.000Z',
  ]);
});

for (const page of ['TeamPage', 'AdminPage']) {
  test(page + ' rejects unauthenticated access before reading visitor or account data', async () => {
    const fixture = pages({ authorized: false });
    await assert.rejects(fixture[page](), /UNAUTHORIZED/);
    assert.equal(fixture.reads, 0);
    assert.equal(fixture.helperCalls, 0);
  });
}
