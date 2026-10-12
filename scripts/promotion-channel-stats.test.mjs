import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const result = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, URL, Date, Error, FormData, require(name) {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const input = load('src/lib/promotion-channel-input.ts');
const data = (values) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'GP77 推广', code: 'gp77', hostname: 'gp77.top', ...values })) form.set(key, value);
  return form;
};

test('channel inputs normalize code and equivalent domains without creating users or sites', () => {
  for (const hostname of ['GP77.TOP', 'https://gp77.top/', 'http://www.gp77.top']) {
    const parsed = input.parsePromotionChannelInput(data({ name: '  GP77 推广  ', code: ' GP77 ', hostname }));
    assert.deepEqual({ ...parsed }, { name: 'GP77 推广', code: 'gp77', hostname: 'gp77.top' });
  }
  const parsed = input.parsePromotionChannelDetails(data({ code: 'attempt-change' }));
  assert.deepEqual({ ...parsed }, { name: 'GP77 推广', hostname: 'gp77.top' });
});

test('invalid names, identifiers, URLs and non-text input are rejected', () => {
  for (const name of ['', ' '.repeat(5), 'a'.repeat(81), 'x\u0000y', 'a\nb']) {
    assert.throws(() => input.parsePromotionChannelInput(data({ name })));
  }
  for (const code of ['', 'a', '-gp77', 'a/b', 'a?b', 'a'.repeat(33), '中文']) {
    assert.throws(() => input.parsePromotionChannelInput(data({ code })));
  }
  for (const hostname of ['', 'localhost', '127.0.0.1', 'https://user:pass@gp77.top', 'gp77.top/path', 'gp77.top?x', 'gp77.top#x', 'gp77.top:9000', '//gp77.top', 'gp77.top\\evil', 'ftp://gp77.top', 'gp77 .top', '-gp77.top', 'x.'.repeat(130) + 'top']) {
    assert.throws(() => input.parsePromotionChannelInput(data({ hostname })), undefined, hostname);
  }
  const file = data({});
  file.set('name', new Blob(['fixture']), 'fixture.txt');
  assert.throws(() => input.parsePromotionChannelInput(file));
  assert.throws(() => input.parsePromotionChannelInput(null), /渠道信息无效/);
});

const NOW = new Date('2026-10-11T04:00:00.000Z');
const START = new Date('2026-10-10T16:00:00.000Z');
const END = new Date('2026-10-11T16:00:00.000Z');
const channels = [
  { id: 'empty', code: 'zero', name: '零访问', hostname: 'zero.test', isActive: true },
  { id: 'a', code: 'gp77', name: 'GP77', hostname: 'gp77.top', isActive: true },
  { id: 'b', code: 'other', name: '其他', hostname: 'other.test', isActive: false },
];
const visits = [
  { channelId: 'a', firstVisitedAt: new Date('2026-10-01T00:00:00Z'), lastVisitedAt: NOW, visitCount: 12 },
  { channelId: 'a', firstVisitedAt: START, lastVisitedAt: NOW, visitCount: 3 },
  { channelId: 'a', firstVisitedAt: END, lastVisitedAt: END, visitCount: 1 },
  { channelId: 'b', firstVisitedAt: new Date('2026-10-10T15:59:59.999Z'), lastVisitedAt: new Date('2026-10-10T04:00:00Z'), visitCount: 8 },
  { channelId: 'b', firstVisitedAt: new Date('2026-10-01T00:00:00Z'), lastVisitedAt: new Date('2026-10-10T03:59:59.999Z'), visitCount: 2 },
];

function fixture() {
  const queries = [];
  const stats = load('src/lib/promotion-channel-stats.ts', {
    'server-only': {},
    '@/lib/china-calendar': load('src/lib/china-calendar.ts'),
    '@/lib/prisma': { prisma: {
      promotionChannel: { findMany: async (query) => {
        queries.push(query);
        assert.deepEqual(Object.keys(query.select).sort(), ['code', 'hostname', 'id', 'isActive', 'name']);
        return channels;
      } },
      promotionChannelVisit: { groupBy: async (query) => {
        queries.push(query);
        const grouped = new Map();
        const records = visits.filter(row => Object.entries(query.where ?? {}).every(([field, range]) =>
          (!range.gte || row[field] >= range.gte) && (!range.lt || row[field] < range.lt)));
        for (const row of records) {
          const group = grouped.get(row.channelId) ?? { channelId: row.channelId, _count: { _all: 0 }, _sum: { visitCount: 0 } };
          group._count._all++;
          group._sum.visitCount += row.visitCount;
          grouped.set(row.channelId, group);
        }
        return [...grouped.values()];
      } },
    } },
  });
  return { ...stats, queries };
}

test('aggregated counts retain zero/inactive channels, count browsers separately from hits, and sort by visitors', async () => {
  const f = fixture();
  const rows = await f.getPromotionChannelStats(NOW);
  assert.deepEqual(Array.from(rows, row => [row.id, row.totalVisitors, row.visitCount]), [
    ['a', 3, 16], ['b', 2, 10], ['empty', 0, 0],
  ]);
  assert.equal(rows[1].isActive, false);
  assert.equal(f.queries.length, 4);
  assert.doesNotMatch(JSON.stringify(rows), /visitorKey|firstVisitedAt|lastVisitedAt/);
});

test('today uses Beijing first-visit bounds while last 24 hours includes returning browsers', async () => {
  const f = fixture();
  const rows = await f.getPromotionChannelStats(NOW);
  assert.deepEqual(Array.from(rows, row => [row.id, row.todayNewVisitors, row.last24HourVisitors]), [
    ['a', 1, 3], ['b', 0, 1], ['empty', 0, 0],
  ]);
  assert.equal(f.queries[2].where.firstVisitedAt.gte.toISOString(), START.toISOString());
  assert.equal(f.queries[2].where.firstVisitedAt.lt.toISOString(), END.toISOString());
  assert.equal(f.queries[3].where.lastVisitedAt.gte.toISOString(), '2026-10-10T04:00:00.000Z');
  const midnight = fixture();
  await midnight.getPromotionChannelStats(new Date(START.getTime() - 1));
  assert.equal(midnight.queries[2].where.firstVisitedAt.lt.toISOString(), START.toISOString());
});
