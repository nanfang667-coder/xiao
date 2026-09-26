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
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, Date, require(name) {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };

test('admin dashboard requires authentication and retains active modules without querying partners', async () => {
  let authorized = true;
  let authorizationChecked = false;
  const queries = [];
  const count = (name, value) => ({ count: async () => {
    assert.equal(authorizationChecked, true);
    queries.push(name);
    return value;
  } });
  const { default: Page } = load('src/app/adminzhangzhang/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/link': link,
    '@/lib/auth': { requireAdmin: async () => {
      if (!authorized) throw new Error('UNAUTHORIZED');
      authorizationChecked = true;
    } },
    '@/lib/prisma': { prisma: {
      teacher: count('teacher', 11),
      teacherSubmission: count('teacherSubmission', 3),
      merchant: count('merchant', 7),
      user: count('user', 19),
    } },
    './actions': { logout() {} },
  });
  const html = renderToStaticMarkup(await Page());
  assert.deepEqual(queries.sort(), ['merchant', 'teacher', 'teacherSubmission', 'user']);
  for (const route of ['sites', 'submissions', 'users', 'teachers', 'merchants']) {
    assert.ok(html.includes(`href="/adminzhangzhang/${route}"`));
  }
  for (const label of ['团队账号管理', '合作帖子管理', '用户管理', '商家管理', '11 位老师', '3 条待审核', '7 个商家', '19 个用户']) {
    assert.ok(html.includes(label));
  }
  assert.doesNotMatch(html, /合作伙伴|友情链接|\/partners/);
  authorized = false;
  authorizationChecked = false;
  await assert.rejects(Page(), /UNAUTHORIZED/);
  assert.equal(queries.length, 4);
});

function renderBrowser(notice = null) {
  const { TeacherBrowser } = load('src/app/TeacherBrowser.tsx', {
    'react/jsx-runtime': jsx,
    react: { useState: () => [notice, () => {}] },
    'next/navigation': { useRouter: () => ({ replace() {} }) },
    'next/link': link,
    '@/lib/membership': { isActiveMember: () => false },
    '@/components/UserStatus': { UserStatus: () => null },
    '@/components/TeacherCard': { TeacherCard: () => null },
    '@/components/NationalPromotionCard': { NationalPromotionCard: () => null },
    '@/components/Pagination': { Pagination: () => null },
    '@/components/SeoLocationPicker': { SeoLocationPicker: () => null },
  });
  return renderToStaticMarkup(React.createElement(TeacherBrowser, {
    teachers: [], nationalPromotions: [], user: null,
    availableLocationSlugs: [], page: 1, totalPages: 1, siteName: '测试站点',
    // A stale caller supplying legacy props must not restore public partner links.
    partnerLinks: [{ id: 1, name: '旧伙伴测试', url: 'https://partner.example.test' }],
  }));
}

test('homepage navigation keeps club, safety and cooperation without public partner links', () => {
  const html = renderBrowser();
  assert.match(html, /href="\/spa"/);
  assert.match(html, /9895会所/);
  assert.match(html, /href="\/safety"/);
  assert.match(html, /防骗指南/);
  assert.match(html, /合作发帖/);
  assert.doesNotMatch(html, /合作伙伴|友情链接|旧伙伴测试|partner\.example\.test/);
});

test('cooperation posting contact dialog remains separate from removed partner links', () => {
  const html = renderBrowser('contact');
  assert.match(html, /如需合作或发布信息/);
  assert.match(html, /href="mailto:/);
  assert.match(html, /知道了/);
  assert.doesNotMatch(html, /合作伙伴|友情链接|partner\.example\.test/);
});

test('home page renders current content without importing or passing partner data', async () => {
  let browserProps;
  const teachers = [{ id: 7 }];
  const promotions = [{ id: 8 }];
  const { default: Page } = load('src/app/page.tsx', {
    'react/jsx-runtime': jsx,
    'next/navigation': {},
    '@/lib/pagination': load('src/lib/pagination.ts', {}),
    '@/lib/teachers': {
      getHomeTeachers: async (page, pageSize) => {
        assert.equal(page, 2);
        assert.equal(pageSize, 10);
        return { teachers, page, totalPages: 3 };
      },
      getActiveNationalPromotions: async () => promotions,
      getAvailableSeoLocationSlugs: async () => new Set(['beijing']),
    },
    '@/lib/user-auth': { getCurrentUser: async () => null },
    '@/lib/location-seo': {},
    '@/lib/site': { getCurrentSite: async () => ({ hostname: 'example.test', name: '测试站点' }) },
    '@/lib/site-utils': { siteOrigin: () => 'https://example.test' },
    './TeacherBrowser': { TeacherBrowser: (props) => {
      browserProps = props;
      return React.createElement('div', null, props.siteName);
    } },
  });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ page: '2' }) }));
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /测试站点/);
  assert.equal(browserProps.teachers, teachers);
  assert.equal(browserProps.nationalPromotions, promotions);
  assert.equal(browserProps.page, 2);
  assert.equal(browserProps.totalPages, 3);
  assert.deepEqual([...browserProps.availableLocationSlugs], ['beijing']);
  assert.equal('partnerLinks' in browserProps, false);
});
