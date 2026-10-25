import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const plain = value => JSON.parse(JSON.stringify(value));
const origin = 'https://merchant.example.test';

function load(file, mocks) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, URL, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

function record(id, isPublished, city, district, sortOrder) {
  const visibility = isPublished ? 'PUBLIC' : 'HIDDEN';
  return {
    id, isPublished, city, district, sortOrder, viewCount: id,
    name: `${visibility}_NAME_${id}`, services: `${visibility}_SERVICES_${id}`,
    description: `${visibility}_DESCRIPTION_${id}`, price: `${visibility}_PRICE_${id}`,
    phone: `${visibility}_PHONE_${id}`, wechat: `${visibility}_WECHAT_${id}`,
    qq: `${visibility}_QQ_${id}`, otherContact: `${visibility}_CONTACT_${id}`,
    address: `${visibility}_ADDRESS_${id}`,
    photos: JSON.stringify([`/synthetic/merchant-${id}.jpg`]),
    createdAt: new Date(`2020-01-${id}T00:00:00Z`),
    updatedAt: new Date(`${isPublished ? '2021' : '2099'}-01-${id}T00:00:00Z`),
  };
}

// Every merchant read and write applies its actual predicate to the mixed data.
// A missing publication filter therefore exposes the hidden fixtures and fails.
function database() {
  const rows = [
    record(11, true, '广东省', '深圳市', 2),
    record(12, false, '北京市', '朝阳区', 0),
    record(13, true, '四川省', '成都市', 1),
    record(14, false, '广东省', '广州市', 3),
  ];
  const calls = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    assert.ok(Object.hasOwn(row, key), 'Unsupported synthetic where field: ' + key);
    assert.ok(value === null || typeof value !== 'object', 'Unsupported synthetic predicate');
    return row[key] === value;
  });
  const select = (row, fields) => fields
    ? Object.fromEntries(Object.entries(fields).filter(([, enabled]) => enabled)
      .map(([key]) => {
        assert.ok(Object.hasOwn(row, key), 'Unsupported synthetic select field: ' + key);
        return [key, row[key]];
      }))
    : { ...row };
  function read(method, args = {}) {
    calls.push({ method, args: plain(args) });
    const result = rows.filter(row => matches(row, args.where));
    const order = args.orderBy ? [].concat(args.orderBy) : [];
    result.sort((left, right) => {
      for (const entry of order) {
        const [key, direction] = Object.entries(entry)[0];
        assert.ok(['asc', 'desc'].includes(direction));
        const difference = left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0;
        if (difference) return difference * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
    return result.map(row => select(row, args.select));
  }
  const prisma = { merchant: {
    findMany: async args => read('findMany', args),
    findFirst: async args => read('findFirst', args)[0] ?? null,
    findUnique: async args => read('findUnique', args)[0] ?? null,
    updateMany: async args => {
      calls.push({ method: 'updateMany', args: plain(args) });
      assert.deepEqual(plain(args.data), { viewCount: { increment: 1 } });
      const matched = rows.filter(row => matches(row, args.where));
      for (const row of matched) row.viewCount += args.data.viewCount.increment;
      return { count: matched.length };
    },
  }, teacher: {
    findMany: async args => {
      calls.push({ method: 'teacher.findMany', args: plain(args) });
      return [];
    },
  } };
  const api = load('src/lib/merchants.ts', { '@/lib/prisma': { prisma } });
  return { rows, calls, prisma, api };
}

const locations = load('src/data/locations.ts', {});
const seo = load('src/lib/location-seo.ts', { '@/data/locations': locations });
const common = {
  'react/jsx-runtime': jsx,
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/lib/site': { getCurrentSite: async () => ({ name: 'Synthetic site' }) },
  '@/lib/site-utils': { siteOrigin: () => origin },
};
const picker = load('src/components/SeoLocationPicker.tsx', { ...common, '@/lib/location-seo': seo });

function listing(f) {
  let pickerProps;
  const { default: Page } = load('src/app/spa/page.tsx', {
    ...common,
    '@/lib/merchants': f.api,
    '@/lib/location-seo': seo,
    '@/components/MerchantCard': { MerchantCard: ({ merchant }) => React.createElement(
      'article', { 'data-merchant': merchant.id }, merchant.name,
    ) },
    '@/components/SeoLocationPicker': { SeoLocationPicker: props => {
      pickerProps = props;
      return React.createElement(picker.SeoLocationPicker, props);
    } },
  });
  return {
    render: async (query = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) })),
    pickerProps: () => pickerProps,
  };
}

function detail(f) {
  const notFound = new Error('SYNTHETIC_NOT_FOUND');
  const effects = [];
  const api = load('src/app/spa/[id]/page.tsx', {
    ...common,
    'next/navigation': { notFound: () => { throw notFound; } },
    '@/lib/merchants': f.api,
    '@/lib/location-label': { formatLocationLabel: (city, district) => `${city} · ${district}` },
    '@/app/teacher/[id]/Gallery': { Gallery: ({ photos }) => {
      effects.push('gallery');
      return React.createElement('div', { 'data-gallery': photos.join(',') });
    } },
    './MerchantViewTracker': { MerchantViewTracker: ({ merchantId }) => {
      effects.push('tracker');
      return React.createElement('span', { 'data-tracker': merchantId });
    } },
  });
  return {
    notFound, effects,
    render: async id => renderToStaticMarkup(await api.default({ params: Promise.resolve({ id }) })),
    metadata: id => api.generateMetadata({ params: Promise.resolve({ id }) }),
  };
}

test('published merchant helpers filter mixed rows while admin helpers retain hidden content', async () => {
  const f = database();
  const published = await f.api.getPublishedMerchants();
  assert.deepEqual(plain(published.map(row => row.id)), [13, 11]);
  assert.ok(published.every(row => row.isPublished));
  assert.deepEqual(plain(published[0].photos), ['/synthetic/merchant-13.jpg']);
  assert.equal(await f.api.getPublishedMerchantById('12'), null);
  assert.equal(await f.api.getPublishedMerchantById('14'), null);
  assert.equal(await f.api.getPublishedMerchantById('999'), null);
  assert.equal((await f.api.getPublishedMerchantById('11')).name, 'PUBLIC_NAME_11');

  const admin = await f.api.getMerchantsForAdmin();
  assert.deepEqual(plain(admin.map(row => row.id)), [12, 13, 11, 14]);
  const hidden = await f.api.getMerchantByIdForAdmin('12');
  assert.equal(hidden.isPublished, false);
  assert.equal(hidden.description, 'HIDDEN_DESCRIPTION_12');
  assert.equal(hidden.phone, 'HIDDEN_PHONE_12');
  assert.deepEqual(plain(hidden.photos), ['/synthetic/merchant-12.jpg']);
  assert.deepEqual(f.calls[0].args.where, { isPublished: true });
});

test('SPA cards and enabled province/city choices come only from published merchants', async () => {
  const page = listing(database());
  const html = await page.render();
  assert.match(html, /PUBLIC_NAME_11/);
  assert.match(html, /PUBLIC_NAME_13/);
  assert.doesNotMatch(html, /HIDDEN_|data-merchant="(?:12|14)"/);
  const expectedSlugs = [
    seo.getSeoLocationFromSelection('广东省').slug,
    seo.getSeoLocationFromSelection('广东省', '深圳市').slug,
    seo.getSeoLocationFromSelection('四川省').slug,
    seo.getSeoLocationFromSelection('四川省', '成都市').slug,
  ].sort();
  assert.deepEqual(plain(page.pickerProps().availableLocationSlugs).sort(), expectedSlugs);
  assert.match(html, /<span[^>]*aria-disabled="true"[^>]*>北京市<\/span>/);
  assert.doesNotMatch(html, /href="\/spa\?location=beijing"/);

  const province = seo.getSeoLocationFromSelection('广东省').slug;
  const provinceHtml = await page.render({ location: province });
  assert.match(provinceHtml, /PUBLIC_NAME_11/);
  assert.doesNotMatch(provinceHtml, /PUBLIC_NAME_13|HIDDEN_/);
  assert.match(provinceHtml, /<span[^>]*aria-disabled="true"[^>]*>广州市<\/span>/);
  assert.doesNotMatch(provinceHtml, /href="\/spa\?location=guangzhou"/);
  for (const query of [
    { location: seo.getSeoLocationFromSelection('广东省', '深圳市').slug },
    { city: '广东省::深圳市' },
  ]) {
    const filtered = await page.render(query);
    assert.match(filtered, /PUBLIC_NAME_11/);
    assert.doesNotMatch(filtered, /PUBLIC_NAME_13|HIDDEN_/);
  }
});

test('hidden details return notFound and noindex metadata without content, canonical or Open Graph', async () => {
  const f = database();
  const page = detail(f);
  for (const id of ['12', '14', '999']) {
    await assert.rejects(page.render(id), error => error === page.notFound);
    const metadata = plain(await page.metadata(id));
    assert.deepEqual(metadata, {
      title: '商家不存在', robots: { index: false, follow: false },
    });
    assert.doesNotMatch(JSON.stringify(metadata), /HIDDEN_|synthetic\/merchant|openGraph|description|alternates/);
  }
  assert.deepEqual(page.effects, []);

  const html = await page.render('11');
  for (const field of ['NAME', 'SERVICES', 'DESCRIPTION', 'PRICE', 'PHONE', 'WECHAT', 'QQ', 'CONTACT', 'ADDRESS']) {
    assert.ok(html.includes(`PUBLIC_${field}_11`), field);
  }
  assert.match(html, /data-gallery="\/synthetic\/merchant-11.jpg"/);
  assert.match(html, /data-tracker="11"/);
  assert.doesNotMatch(html, /HIDDEN_/);
  const metadata = await page.metadata('11');
  assert.equal(metadata.alternates.canonical, `${origin}/spa/11`);
  assert.equal(metadata.description, 'PUBLIC_DESCRIPTION_11');
  assert.match(metadata.openGraph.title, /PUBLIC_NAME_11/);
  assert.equal(metadata.openGraph.url, `${origin}/spa/11`);
  assert.deepEqual(page.effects, ['tracker', 'gallery']);
});

test('sitemap excludes hidden merchant URLs and their newer update timestamps', async () => {
  const f = database();
  const { default: sitemap } = load('src/app/sitemap.ts', {
    ...common,
    '@/lib/prisma': { prisma: f.prisma },
    '@/lib/location-seo': seo,
    '@/lib/site-config': { MIN_ACCESSIBLE_LOCATION_RECORDS: 1 },
  });
  const entries = await sitemap();
  assert.deepEqual(plain(entries.filter(entry => /\/spa\/\d+$/.test(entry.url)).map(entry => entry.url)), [
    `${origin}/spa/11`, `${origin}/spa/13`,
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /\/spa\/(?:12|14)|HIDDEN_|2099/);
  for (const path of ['/', '/fenglou', '/spa']) {
    assert.equal(entries.find(entry => entry.url === origin + path).lastModified.toISOString(),
      '2021-01-13T00:00:00.000Z');
  }
  const merchantRead = f.calls.find(call => call.method === 'findMany');
  assert.deepEqual(merchantRead.args.where, { isPublished: true });
  assert.deepEqual(merchantRead.args.select, { id: true, updatedAt: true });
});

function tracking(f) {
  class NextResponse extends Response {
    static json(body, init) {
      return new NextResponse(JSON.stringify(body), {
        ...init, headers: { 'content-type': 'application/json' },
      });
    }
  }
  const { POST } = load('src/app/api/merchants/[id]/view/route.ts', {
    'next/server': { NextResponse }, '@/lib/prisma': { prisma: f.prisma },
  });
  return (id, requestOrigin = origin) => POST(new Request(`${origin}/api/merchants/${id}/view`, {
    method: 'POST', headers: { origin: requestOrigin, host: new URL(origin).host },
  }), { params: Promise.resolve({ id }) });
}

test('reading counter returns 404 for hidden or missing merchants without incrementing any count', async () => {
  const f = database();
  const post = tracking(f);
  const before = f.rows.map(row => row.viewCount);
  for (const id of ['12', '14', '999']) {
    const response = await post(id);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Merchant not found' });
    assert.deepEqual(f.rows.map(row => row.viewCount), before);
  }
  const response = await post('11');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual(f.rows.map(row => row.viewCount), [12, 12, 13, 14]);
  assert.ok(f.calls.every(call => call.method === 'updateMany' && call.args.where.isPublished === true));
  const calls = f.calls.length;
  assert.equal((await post('13', 'https://other.example.test')).status, 403);
  assert.equal((await post('not-an-id')).status, 400);
  assert.equal(f.calls.length, calls);
});

test('an entirely hidden catalogue has no public cards or selectable regions but remains editable by admin', async () => {
  const f = database();
  for (const row of f.rows) row.isPublished = false;
  const page = listing(f);
  const html = await page.render({ location: 'guangdong' });
  assert.match(html, /暂时还没有公开商家/);
  assert.doesNotMatch(html, /data-merchant=|PUBLIC_NAME_|HIDDEN_NAME_/);
  assert.deepEqual(plain(page.pickerProps().availableLocationSlugs), []);
  assert.doesNotMatch(html, /href="\/spa\?location=/);
  assert.equal((await f.api.getMerchantsForAdmin()).length, 4);
  assert.equal((await f.api.getMerchantByIdForAdmin('11')).isPublished, false);
});
