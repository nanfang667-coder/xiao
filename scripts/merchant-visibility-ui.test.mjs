import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { load as parseHtml } from 'cheerio';

function load(file, mocks) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URLSearchParams, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Unmocked dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
}

function buttonHarness(isPublished) {
  let pending = false;
  let error = '';
  let action = async () => ({});
  let currentTransition = Promise.resolve();
  const calls = [];
  const { MerchantVisibilityButton } = load('src/app/adminzhangzhang/merchants/MerchantVisibilityButton.tsx', {
    'react/jsx-runtime': jsx,
    react: {
      useState: () => [error, (value) => { error = value; }],
      useTransition: () => [pending, (callback) => {
        pending = true;
        currentTransition = Promise.resolve(callback()).finally(() => { pending = false; });
      }],
    },
    './actions': { setMerchantVisibility: async (...args) => {
      calls.push(args);
      return action(...args);
    } },
  });
  function tree() { return MerchantVisibilityButton({ id: 7, isPublished }); }
  return {
    calls,
    button: () => findNode(tree(), (node) => node.type === 'button'),
    html: () => renderToStaticMarkup(tree()),
    settle: () => currentTransition,
    action: (next) => { action = next; },
    published: (next) => { isPublished = next; },
  };
}

test('public and hidden buttons send absolute visibility targets without changing local publication state', async () => {
  for (const published of [true, false]) {
    const harness = buttonHarness(published);
    assert.equal(harness.button().props.children, published ? '隐藏' : '恢复展示');
    assert.equal(harness.button().props.type, 'button');
    assert.equal(harness.button().props['aria-label'], published ? '隐藏商家帖子' : '恢复商家帖子展示');
    harness.button().props.onClick();
    await harness.settle();
    assert.deepEqual(harness.calls, [[7, !published]]);
    assert.equal(harness.button().props.children, published ? '隐藏' : '恢复展示');
    harness.published(!published);
    assert.equal(harness.button().props.children, published ? '恢复展示' : '隐藏');
    assert.doesNotMatch(harness.html(), /role="alert"/);
  }
});

test('pending visibility changes disable the button and guard another click', async () => {
  const harness = buttonHarness(true);
  let resolve;
  harness.action(() => new Promise((done) => { resolve = done; }));
  harness.button().props.onClick();
  assert.equal(harness.button().props.disabled, true);
  assert.equal(harness.button().props['aria-busy'], true);
  assert.equal(harness.button().props.children, '处理中…');
  harness.button().props.onClick();
  assert.deepEqual(harness.calls, [[7, false]]);
  resolve({});
  await harness.settle();
  assert.equal(harness.button().props.disabled, false);
  assert.equal(harness.button().props['aria-busy'], false);
});

test('returned and thrown failures show fixed feedback and a retry clears the error', async () => {
  for (const failure of [
    async () => ({ error: '<private>database details</private>' }),
    async () => { throw new Error('private network details'); },
  ]) {
    const harness = buttonHarness(false);
    harness.action(failure);
    harness.button().props.onClick();
    await harness.settle();
    assert.match(harness.html(), /role="alert"/);
    assert.match(harness.html(), /操作失败，请稍后重试。/);
    assert.doesNotMatch(harness.html(), /private|database|network/);
    assert.equal(harness.button().props.children, '恢复展示');
    let resolve;
    harness.action(() => new Promise((done) => { resolve = done; }));
    harness.button().props.onClick();
    assert.doesNotMatch(harness.html(), /role="alert"/);
    resolve({});
    await harness.settle();
    assert.deepEqual(harness.calls, [[7, true], [7, true]]);
    assert.doesNotMatch(harness.html(), /role="alert"/);
  }
});

const locations = load('src/data/locations.ts', {});
const filters = load('src/lib/admin-merchant-filters.ts', { '@/data/locations': locations });
const linkMock = { default: ({ children, ...props }) => React.createElement('a', props, children) };

function formMarkup(initial) {
  const { MerchantForm } = load('src/app/adminzhangzhang/merchants/MerchantForm.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': linkMock,
    react: {
      useState: (value) => [value, () => {}],
      useRef: () => ({ current: null }),
      useEffect() {},
    },
    '@/data/locations': locations,
    '@/lib/photo': { isImage: () => false },
  });
  return parseHtml(renderToStaticMarkup(React.createElement(MerchantForm, {
    action: '/synthetic-save', submitLabel: '保存', initial,
  })));
}

test('display radios share the existing field and default new or published merchants to normal', () => {
  for (const initial of [undefined, { isPublished: true, photos: [] }]) {
    const $ = formMarkup(initial);
    assert.equal($('input[name="isPublished"]').length, 2);
    assert.equal($('input[type="radio"][name="isPublished"]').length, 2);
    assert.equal($('input[name="isPublished"][value="on"]').is('[checked]'), true);
    assert.equal($('input[name="isPublished"][value="off"]').is('[checked]'), false);
    assert.match($('fieldset').text(), /显示设置/);
    assert.match($('fieldset').text(), /正常显示/);
    assert.match($('fieldset').text(), /隐藏此商家帖子/);
    assert.match($('fieldset').text(), /访客看不到此商家的列表或详情，后台可随时恢复展示/);
  }
});

test('editing a hidden merchant selects hidden while preserving existing sort order and other fields', () => {
  const $ = formMarkup({ isPublished: false, photos: [], name: '合成隐藏商家', city: '上海市', district: '黄浦区', sortOrder: 12 });
  assert.equal($('input[name="isPublished"][value="off"]').is('[checked]'), true);
  assert.equal($('input[name="isPublished"][value="on"]').is('[checked]'), false);
  assert.equal($('input[name="sortOrder"]').attr('value'), '12');
  assert.equal($('input[name="name"]').attr('value'), '合成隐藏商家');
  assert.equal($('input[name="city"]').attr('value'), '上海市');
  assert.equal($('input[name="district"]').attr('value'), '黄浦区');
});

function pageHarness() {
  let authorized = true;
  let reads = 0;
  const buttonProps = [];
  const records = [
    { id: 9, name: '合成隐藏商家', isPublished: false, sortOrder: 1 },
    { id: 7, name: '合成公开商家', isPublished: true, sortOrder: 2 },
  ].map((row) => ({ ...row, photos: [], viewCount: 0, city: '上海市', district: '黄浦区' }));
  const { default: Page } = load('src/app/adminzhangzhang/merchants/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': linkMock,
    '@/lib/auth': { requireAdmin: async () => { if (!authorized) throw new Error('UNAUTHORIZED'); } },
    '@/lib/merchants': { getMerchantsForAdmin: async () => { reads += 1; return records; } },
    '@/lib/admin-merchant-filters': filters,
    '@/lib/photo': { isImage: () => false },
    '@/lib/location-label': { formatLocationLabel: () => '' },
    './DeleteMerchantButton': { DeleteMerchantButton: () => React.createElement('button', null, '删除') },
    './AdminMerchantFilters': { AdminMerchantFilters: ({ total }) => React.createElement('p', null, `地区筛选合成计数 ${total}`) },
    './MerchantVisibilityButton': { MerchantVisibilityButton: (props) => {
      buttonProps.push(props);
      return React.createElement('button', { 'data-id': props.id }, props.isPublished ? '隐藏' : '恢复展示');
    } },
  });
  return {
    render: async () => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ province: '上海市', city: '黄浦区' }) })),
    deny: () => { authorized = false; },
    reads: () => reads,
    buttonProps,
  };
}

test('admin list retains hidden merchants and region counts, marks hidden state, and offers matching controls', async () => {
  const harness = pageHarness();
  const html = await harness.render();
  const $ = parseHtml(html);
  assert.match(html, /已隐藏/);
  assert.match(html, /地区筛选合成计数 2/);
  assert.match(html, /恢复展示/);
  assert.match(html, />隐藏<\/button>/);
  assert.ok(html.indexOf('合成隐藏商家') < html.indexOf('合成公开商家'));
  assert.equal($('a[href="/adminzhangzhang/merchants/9/edit"]').length, 1);
  assert.equal($('a[href="/adminzhangzhang/merchants/7/edit"]').length, 1);
  assert.equal($('button').filter((_index, node) => $(node).text() === '删除').length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.buttonProps)), [{ id: 9, isPublished: false }, { id: 7, isPublished: true }]);
});

test('admin authorization completes before records or visibility controls are exposed', async () => {
  const harness = pageHarness();
  harness.deny();
  await assert.rejects(harness.render(), /UNAUTHORIZED/);
  assert.equal(harness.reads(), 0);
  assert.deepEqual(harness.buttonProps, []);
});
