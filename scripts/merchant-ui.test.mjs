import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { URL, ...globals, exports, require(name) {
    assert.ok(name in mocks, 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

test('merchant tracker records once per mount and ignores request failures', async () => {
  const effects = [];
  const requests = [];
  const ref = { current: null };
  const { MerchantViewTracker } = load('src/app/spa/[id]/MerchantViewTracker.tsx', {
    react: { useRef: () => ref, useEffect: (effect) => effects.push(effect) },
  }, { fetch: async (url, options) => {
    requests.push({ url, method: options.method });
    throw new Error('offline');
  } });
  MerchantViewTracker({ merchantId: 7 });
  effects[0]();
  effects[0]();
  await Promise.resolve();
  assert.deepEqual(requests, [{ url: '/api/merchants/7/view', method: 'POST' }]);
  ref.current = null;
  MerchantViewTracker({ merchantId: 7 });
  effects[1]();
  await Promise.resolve();
  assert.equal(requests.length, 2);
});

test('merchant views reject invalid requests and atomically count only published posts', async () => {
  const writes = [];
  let count = 1;
  const { POST } = load('src/app/api/merchants/[id]/view/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/prisma': { prisma: { merchant: { updateMany: async (args) => {
      writes.push(args);
      if (count === -1) throw new Error('offline');
      return { count };
    } } } },
  });
  const request = (origin = 'https://example.test') => ({
    headers: new Headers({ origin, host: 'example.test' }), nextUrl: new URL('http://0.0.0.0:3000/api/merchants/7/view'),
  });
  const params = (id) => ({ params: Promise.resolve({ id }) });
  assert.equal((await POST(request('https://other.test'), params('7'))).status, 403);
  assert.equal((await POST(request('not-a-url'), params('7'))).status, 403);
  assert.equal((await POST(request('https://example.test:444'), params('7'))).status, 403);
  for (const host of ['localhost:3000', '127.0.0.1:3000']) {
    const req = { headers: new Headers({ origin: `http://${host}`, host }),
      nextUrl: new URL('http://0.0.0.0:3000/api/merchants/0/view') };
    assert.equal((await POST(req, params('0'))).status, 400);
  }
  for (const id of ['0', '-1', 'abc', '1.5', '9007199254740992']) {
    assert.equal((await POST(request(), params(id))).status, 400);
  }
  assert.equal(writes.length, 0);
  assert.equal((await POST(request(), params('7'))).status, 204);
  assert.equal(JSON.stringify(writes[0]), JSON.stringify({
    where: { id: 7, isPublished: true }, data: { viewCount: { increment: 1 } },
  }));
  count = 0;
  assert.equal((await POST(request(), params('7'))).status, 404);
  count = -1;
  assert.equal((await POST(request(), params('7'))).status, 503);
});

test('admin merchant list displays zero and formatted view counts behind admin authorization', async () => {
  let authorized = true;
  const { default: Page } = load('src/app/adminzhangzhang/merchants/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/merchants': { getMerchantsForAdmin: async () => [0, 1234].map((viewCount, id) => ({
      id, name: '测试商家', photos: [], isPublished: true, viewCount,
    })) },
    '@/lib/photo': { isImage: () => false },
    '@/lib/location-label': { formatLocationLabel: () => '' },
    './DeleteMerchantButton': { DeleteMerchantButton: () => null },
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /阅读量 0 次/);
  assert.match(html, /阅读量 1,234 次/);
  authorized = false;
  await assert.rejects(Page(), /UNAUTHORIZED/);
});

function actions(authorized = true) {
  const writes = [];
  const api = load('src/app/adminzhangzhang/merchants/actions.ts', {
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect() { throw new Error('REDIRECT'); } },
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/image-upload': { getSelectedPhotoFiles: () => [], saveUploadedPhotos: async () => [] },
    '@/lib/uploaded-photos': { deleteUploadedPhotos: async () => {} },
    '@/lib/prisma': { prisma: { merchant: {
      create: async ({ data }) => { writes.push(data); return { id: 7 }; },
      findUnique: async () => ({ id: 7, photos: '[]' }),
      update: async ({ data }) => { writes.push(data); },
    } } },
  });
  return { api, writes };
}

test('empty merchant can be created and edited with safe defaults', async () => {
  const { api, writes } = actions();
  const form = new FormData();
  form.set('name', '  ');
  form.set('services', '  ');
  form.set('sortOrder', '');
  await assert.rejects(api.createMerchant(form), /REDIRECT/);
  await assert.rejects(api.updateMerchant(7, form), /REDIRECT/);
  assert.equal(writes.length, 2);
  for (const data of writes) {
    assert.equal(data.name, '');
    assert.equal(data.services, '');
    assert.equal(data.address, null);
    assert.equal(data.sortOrder, 100);
  }
});

test('filled fields retain limits and invalid sorting cannot be saved', async () => {
  const { api, writes } = actions();
  for (const [key, value] of [['name', 'x'.repeat(81)], ['services', 'x'.repeat(2001)], ['sortOrder', '0']]) {
    const form = new FormData();
    form.set(key, value);
    await assert.rejects(api.createMerchant(form), /不能超过|排序必须/);
  }
  assert.equal(writes.length, 0);
});

test('blank forms still require administrator authorization', async () => {
  const { api, writes } = actions(false);
  await assert.rejects(api.createMerchant(new FormData()), /UNAUTHORIZED/);
  assert.equal(writes.length, 0);
});

test('merchant cards show escaped full addresses and omit empty rows', () => {
  const { MerchantCard } = load('src/components/MerchantCard.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/location-label': { formatLocationLabel: () => '上海市' },
    '@/lib/photo': { isImage: () => false },
  });
  const merchant = { id: 7, name: '', city: '', district: '', price: null, services: '', photos: [], address: '<script>测试</script>' };
  const html = renderToStaticMarkup(React.createElement(MerchantCard, { merchant }));
  assert.match(html, /商家 #7/);
  assert.match(html, /&lt;script&gt;测试&lt;\/script&gt;/);
  assert.doesNotMatch(html, /地址：/);
  assert.ok(html.indexOf("上海市") < html.indexOf("&lt;script&gt;"));
  assert.ok(html.indexOf("&lt;script&gt;") < html.indexOf("<h2"));
  assert.doesNotMatch(html, /<script>/);
  const blank = renderToStaticMarkup(React.createElement(MerchantCard, { merchant: { ...merchant, address: null } }));
  assert.doesNotMatch(blank, /break-words/);
});
