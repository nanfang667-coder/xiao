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
