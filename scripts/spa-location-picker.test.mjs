import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
function load(file, mocks) {
  const exports = {};
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  return exports;
}
const locations = load('src/data/locations.ts', {});
const seo = load('src/lib/location-seo.ts', { '@/data/locations': locations });
const common = { 'react/jsx-runtime': jsx, 'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) } };
const picker = load('src/components/SeoLocationPicker.tsx', { ...common, '@/lib/location-seo': seo });
const merchants = [
  { id: 1, city: '四川省', district: '成都市' },
  { id: 2, city: '陕西省', district: '西安市' },
  { id: 3, city: '四川省', district: '' },
];
async function render(query = {}, records = merchants) {
  const { default: Page } = load('src/app/spa/page.tsx', {
    ...common, '@/components/SeoLocationPicker': picker, '@/lib/location-seo': seo,
    '@/components/MerchantCard': { MerchantCard: ({ merchant }) => React.createElement('article', { 'data-merchant': merchant.id }) },
    '@/lib/merchants': { getPublishedMerchants: async () => records },
    '@/lib/site': {}, '@/lib/site-utils': {},
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}

test('SPA shows every province and unavailable provinces have no clickable link', async () => {
  const html = await render();
  for (const province of locations.provinces) assert.ok(html.includes(province));
  assert.match(html, /<span[^>]*aria-disabled="true"[^>]*text-gray-300[^>]*>北京市<\/span>/);
  assert.match(html, /<a[^>]*href="\/spa\?location=[^"]+"[^>]*>四川省<\/a>/);
});

test('province selection shows all cities, disables empty cities and includes province-only posts', async () => {
  const slug = seo.getSeoLocationFromSelection('四川省').slug;
  const html = await render({ location: slug });
  for (const city of locations.citiesOfProvince('四川省')) assert.ok(html.includes(city));
  assert.match(html, /aria-disabled="true"[^>]*>绵阳市<\/span>/);
  assert.match(html, /data-merchant="1"/);
  assert.match(html, /data-merchant="3"/);
  assert.doesNotMatch(html, /data-merchant="2"/);
});

test('city selection and legacy city links filter correctly; invalid selections fall back to all', async () => {
  for (const query of [{ location: seo.getSeoLocationFromSelection('四川省', '成都市').slug }, { city: '四川省::成都市' }]) {
    const html = await render(query);
    assert.match(html, /data-merchant="1"/);
    assert.doesNotMatch(html, /data-merchant="[23]"/);
  }
  assert.match(await render({ location: 'invalid' }), /data-merchant="2"/);
  const empty = await render({}, []);
  assert.match(empty, /暂时还没有公开商家/);
  assert.match(empty, /aria-disabled="true"[^>]*>四川省<\/span>/);
});
