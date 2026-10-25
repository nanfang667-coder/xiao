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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { URLSearchParams, exports, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const locations = load('src/data/locations.ts', {});
const filtersApi = load('src/lib/admin-merchant-filters.ts', { '@/data/locations': locations });
const { parseAdminMerchantFilters, filterMerchantsForAdmin } = filtersApi;
const plain = (value) => JSON.parse(JSON.stringify(value));
const merchants = Object.freeze([
  { id: 1, city: '上海市', district: '黄浦区', isPublished: false },
  { id: 2, city: '上海', district: '浦东新区', isPublished: true },
  { id: 3, city: '广东省', district: '深圳市', isPublished: true },
  { id: 4, city: '广东', district: '广州', isPublished: false },
  { id: 5, city: '广东省', district: '', isPublished: true },
  { id: 6, city: '', district: '', isPublished: false },
  { id: 7, city: '海外', district: '新宿区', isPublished: true },
  { id: 8, city: '上海市', district: '上海市黄浦区', isPublished: true },
  { id: 9, city: '江苏省', district: '南京市', isPublished: true },
  { id: 10, city: '北京市', district: '朝阳区', isPublished: true },
  { id: 11, city: '辽宁省', district: '朝阳市', isPublished: true },
].map(Object.freeze));

test('URL filters normalize provinces and reject invalid or cross-province cities', () => {
  const cases = [
    [{}, { province: '', city: '' }],
    [{ province: ' 广东 ', city: ' 深圳市 ' }, { province: '广东省', city: '深圳市' }],
    [{ province: ['上海市', '广东省'], city: ['黄浦区', '深圳市'] }, { province: '上海市', city: '黄浦区' }],
    [{ province: '广东省', city: '黄浦区' }, { province: '广东省', city: '' }],
    [{ city: '深圳市' }, { province: '', city: '' }],
    [{ province: '<script>', city: '深圳市' }, { province: '', city: '' }],
    [{ province: [], city: [] }, { province: '', city: '' }],
  ];
  for (const [params, expected] of cases) {
    assert.deepEqual(plain(parseAdminMerchantFilters(params)), expected);
  }
});

test('all merchants, including unpublished and unknown locations, keep their existing order', () => {
  const result = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({}));
  assert.deepEqual(plain(result.merchants), plain(merchants));
  assert.equal(result.total, 11);
  assert.equal(result.allLocationTotal, 11);
  assert.equal(result.provinceCounts['上海市'], 3);
  assert.equal(result.provinceCounts['广东省'], 3);
  assert.equal(result.provinceCounts['海南省'], 0);
  assert.deepEqual(Object.keys(result.cityCounts), []);
});

test('province filtering includes province-only merchants and builds city counts from that province', () => {
  const result = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({ province: '广东' }));
  assert.deepEqual(plain(result.merchants.map((item) => item.id)), [3, 4, 5]);
  assert.equal(result.total, 3);
  assert.equal(result.allLocationTotal, 11);
  assert.equal(result.cityCounts['深圳市'], 1);
  assert.equal(result.cityCounts['广州市'], 1);
  assert.equal(result.cityCounts['珠海市'], 0);
  assert.equal(result.cityCounts['黄浦区'], undefined);
});

test('city filters support old abbreviated or prefixed data without narrowing other city counts', () => {
  const result = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({ province: '上海市', city: '黄浦区' }));
  assert.deepEqual(plain(result.merchants.map((item) => item.id)), [1, 8]);
  assert.equal(result.total, 2);
  assert.equal(result.cityCounts['浦东新区'], 1);
  assert.equal(result.cityCounts['黄浦区'], 2);
  assert.equal(result.provinceCounts['广东省'], 3);
  const guangzhou = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({ province: '广东省', city: '广州市' }));
  assert.deepEqual(plain(guangzhou.merchants.map((item) => item.id)), [4]);
});

test('municipal districts are scoped to their province and valid empty regions remain selectable', () => {
  const beijing = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({ province: '北京市', city: '朝阳区' }));
  assert.deepEqual(plain(beijing.merchants.map((item) => item.id)), [10]);
  const empty = filterMerchantsForAdmin(merchants, parseAdminMerchantFilters({ province: '海南省', city: '海口市' }));
  assert.equal(empty.total, 0);
  assert.equal(empty.cityCounts['海口市'], 0);
  assert.equal(empty.allLocationTotal, 11);
  assert.equal(filterMerchantsForAdmin([], parseAdminMerchantFilters({})).total, 0);
});

function pageHarness(records = merchants) {
  let authorized = true;
  let reads = 0;
  let filterProps;
  const { default: Page } = load('src/app/adminzhangzhang/merchants/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/merchants': { getMerchantsForAdmin: async () => {
      reads += 1;
      return records.map((row) => ({ ...row, name: '合成商家' + row.id, photos: [], viewCount: 0 }));
    } },
    '@/lib/admin-merchant-filters': filtersApi,
    '@/lib/photo': { isImage: () => false },
    '@/lib/location-label': { formatLocationLabel: (province, city) => [province, city].filter(Boolean).join(' · ') },
    './DeleteMerchantButton': { DeleteMerchantButton: () => null },
    './MerchantVisibilityButton': { MerchantVisibilityButton: () => null },
    './AdminMerchantFilters': { AdminMerchantFilters: (props) => { filterProps = props; return null; } },
  });
  return {
    async render(params = {}) {
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    },
    deny() { authorized = false; },
    reads: () => reads,
    filterProps: () => filterProps,
  };
}

test('admin page filters records server-side and passes only selected locations and counts to the picker', async () => {
  const harness = pageHarness();
  const html = await harness.render({ province: '广东省', city: '深圳市' });
  assert.match(html, /合成商家3/);
  assert.doesNotMatch(html, /合成商家[12456789]/);
  assert.match(html, /添加商家/);
  assert.equal(harness.reads(), 1);
  assert.deepEqual(Object.keys(harness.filterProps()).sort(), ['allLocationTotal', 'city', 'cityCounts', 'province', 'provinceCounts', 'total']);
  assert.equal(harness.filterProps().total, 1);
  assert.equal(harness.filterProps().allLocationTotal, 11);
});

test('admin page distinguishes no merchants from no matches and authenticates before reading records', async () => {
  assert.match(await pageHarness([]).render(), /还没有商家/);
  assert.match(await pageHarness().render({ province: '海南省' }), /没有符合条件的商家/);
  const harness = pageHarness();
  harness.deny();
  await assert.rejects(harness.render({ province: '上海市' }), /UNAUTHORIZED/);
  assert.equal(harness.reads(), 0);
});
