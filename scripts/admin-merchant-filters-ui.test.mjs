import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { load as parseHtml } from 'cheerio';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { URLSearchParams, exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const locations = load('src/data/locations.ts');
const merchantsPath = '/adminzhangzhang/merchants';

function render(overrides = {}, locationData = locations) {
  const links = [];
  const { AdminMerchantFilters } = load('src/app/adminzhangzhang/merchants/AdminMerchantFilters.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, prefetch, scroll, ...props }) => {
      links.push({ ...props, prefetch, scroll });
      return React.createElement('a', props, children);
    } },
    '@/data/locations': locationData,
  });
  const html = renderToStaticMarkup(React.createElement(AdminMerchantFilters, {
    province: '', city: '', total: 12, allLocationTotal: 12,
    provinceCounts: { 广东省: 9, 北京市: 3 }, cityCounts: {}, ...overrides,
  }));
  return { html, $: parseHtml(html), links };
}

function findOption($, name) {
  return $('nav .grid a').filter((_index, element) => $(element).clone().children().remove().end().text().trim() === name);
}

function queryOf(href) {
  const url = new URL(href, 'https://example.test');
  assert.equal(url.pathname, merchantsPath);
  return Object.fromEntries(url.searchParams);
}

test('all regions render a three-column province picker with counts and clickable zeroes', () => {
  const { $, links } = render();
  assert.equal($('details').is('[open]'), true);
  assert.equal($('nav[aria-label="商家地区筛选"]').length, 1);
  assert.equal($('nav .grid.grid-cols-3').length, 1);
  assert.equal($('nav .grid a').length, locations.provinces.length + 1);
  assert.match($('summary').text(), /全部地区/);
  assert.match($('summary').text(), /当前条件共 12 家商家/);
  const all = findOption($, '全部');
  assert.equal(all.attr('href'), merchantsPath);
  assert.equal(all.attr('aria-current'), 'page');
  assert.match(all.attr('class'), /text-pink-500/);
  assert.equal(all.find('span').text(), '12');
  assert.equal(findOption($, '北京市').find('span').text(), '3');
  assert.equal(findOption($, '台湾省').find('span').text(), '0');
  assert.deepEqual(queryOf(findOption($, '台湾省').attr('href')), { province: '台湾省' });
  assert.equal($('input').length, 0);
  for (const link of links) {
    assert.equal(link.prefetch, false);
    assert.equal(link.scroll, false);
  }
});

test('choosing a city retains its province and every link replaces the previous city', () => {
  const { $, links } = render({
    province: '广东省', city: '深圳市', total: 3,
    cityCounts: { 深圳市: 3, 广州市: 6 },
  });
  assert.match($('summary').text(), /广东省 · 深圳市/);
  assert.match($('summary').text(), /当前条件共 3 家商家/);
  assert.equal($('nav .grid a').length, locations.citiesOfProvince('广东省').length + 1);
  assert.equal(findOption($, '深圳市').attr('aria-current'), 'page');
  assert.match(findOption($, '深圳市').attr('class'), /text-pink-500/);
  assert.equal(findOption($, '广州市').attr('aria-current'), undefined);
  assert.deepEqual(queryOf(findOption($, '广州市').attr('href')), { province: '广东省', city: '广州市' });
  const all = findOption($, '全部');
  assert.equal(all.find('span').text(), '9');
  assert.deepEqual(queryOf(all.attr('href')), { province: '广东省' });
  assert.equal(all.attr('aria-current'), undefined);
  const reset = $('nav > a');
  assert.equal(reset.text().trim(), '‹ 重新选择省份');
  assert.equal(reset.attr('href'), merchantsPath);
  assert.deepEqual(queryOf(findOption($, '珠海市').attr('href')), { province: '广东省', city: '珠海市' });
  assert.equal(findOption($, '珠海市').find('span').text(), '0');
  for (const link of links) {
    assert.equal(link.prefetch, false);
    assert.equal(link.scroll, false);
    const params = queryOf(link.href);
    assert.ok(Object.keys(params).every((key) => key === 'province' || key === 'city'));
    assert.ok(!params.city || params.province);
  }
});

test('province-wide and empty selections show the correct all choice and total', () => {
  const province = render({ province: '广东省', total: 9 });
  assert.equal(findOption(province.$, '全部').attr('aria-current'), 'page');
  assert.match(province.$('summary').text(), /当前条件共 9 家商家/);
  assert.doesNotMatch(province.$('summary').text(), / · /);
  const empty = render({ total: 0, allLocationTotal: 0, provinceCounts: {}, cityCounts: {}, city: '深圳市' });
  assert.match(empty.$('summary').text(), /全部地区/);
  assert.match(empty.$('summary').text(), /当前条件共 0 家商家/);
  assert.equal(findOption(empty.$, '全部').attr('href'), merchantsPath);
  assert.equal(findOption(empty.$, '全部').attr('aria-current'), 'page');
  assert.ok(empty.$('nav .grid a span').toArray().every((element) => empty.$(element).text() === '0'));
});

test('municipalities offer district filters rather than other provinces', () => {
  const { $ } = render({
    province: '上海市', city: '浦东新区', total: 2,
    provinceCounts: { 上海市: 5 }, cityCounts: { 浦东新区: 2, 黄浦区: 3 },
  });
  assert.match($('summary').text(), /上海市 · 浦东新区/);
  assert.equal($('nav .grid a').length, locations.citiesOfProvince('上海市').length + 1);
  assert.deepEqual(queryOf(findOption($, '浦东新区').attr('href')), { province: '上海市', city: '浦东新区' });
  assert.equal(findOption($, '浦东新区').find('span').text(), '2');
  assert.equal(findOption($, '浦东新区').attr('aria-current'), 'page');
  assert.equal(findOption($, '北京市').length, 0);
  assert.equal(findOption($, '全部').find('span').text(), '5');
});

test('region summaries, labels and query parameters escape special characters', () => {
  const province = '<script>省 & q=1</script>';
  const city = '城"市&city=伪造#片段';
  const { html, $ } = render({
    province, city, total: 1, provinceCounts: { [province]: 1 }, cityCounts: { [city]: 1 },
  }, { provinces: [province], citiesOfProvince: () => [city] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;/);
  assert.equal($('script').length, 0);
  assert.deepEqual(queryOf(findOption($, city).attr('href')), { province, city });
  assert.equal(findOption($, city).attr('title'), `${city} 1 家`);
});

test('the native disclosure supplies open and closed labels without browser-only state', () => {
  const { $ } = render();
  assert.match($('details').attr('class'), /\bgroup\b/);
  assert.equal($('summary > span:last-child > span.group-open\\:hidden').text(), '选择地区');
  assert.equal($('summary > span:last-child > span.group-open\\:inline').text(), '收起');
  assert.equal($('button, form, script').length, 0);
});
