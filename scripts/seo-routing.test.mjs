import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

function loadSource(file, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, Date, console, ...globals, require(name) {
    if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

test('homepage has a page-specific canonical and redirects overflow', async () => {
  const pagination = loadSource('src/lib/pagination.ts', {});
  const home = loadSource('src/app/page.tsx', {
    'react/jsx-runtime': {},
    'next/navigation': { redirect: (url) => { throw new Error('redirect:' + url); } },
    '@/lib/pagination': pagination,
    '@/lib/teachers': { getHomeTeachers: async () => ({ page: 2 }),
      getActiveNationalPromotions: async () => [], getAvailableSeoLocationSlugs: async () => new Set() },
    '@/lib/user-auth': { getCurrentUser: async () => null },
    '@/lib/location-seo': {},
    '@/lib/site': { getCurrentSite: async () => ({ hostname: 'example.test', name: 'Test' }) },
    '@/lib/site-utils': { siteOrigin: () => 'https://example.test' },
    './TeacherBrowser': {},
  });
  const metadata = await home.generateMetadata({ searchParams: Promise.resolve({ page: '2' }) });
  assert.equal(metadata.alternates.canonical, 'https://example.test/?page=2');
  await assert.rejects(home.default({ searchParams: Promise.resolve({ page: '999' }) }), /redirect:\/\?page=2/);
});

test('public detail retains free contacts without authentication or payment dependencies', async () => {
  const jsx = (_type, props) => props;
  const teacher = { id: 7, name: 'Test', city: '', district: '', photos: [], services: '' };
  const detail = loadSource('src/app/teacher/[id]/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': {},
    'next/navigation': { notFound: () => { throw new Error('not found'); } },
    '@/lib/teachers': {
      getTeacherPublicById: async () => teacher,
      getTeacherContactById: async () => ({ phone: 'test-phone', wechat: 'test-wechat' }),
    },
    '@/lib/location-label': { formatLocationLabel: () => '' },
    '@/lib/location-seo': { getSeoLocationsForRecord: () => [] },
    '@/lib/site': { getCurrentSite: async () => ({ name: 'Test' }) },
    '@/lib/site-utils': { siteOrigin: () => 'https://example.test' },
    './Gallery': {}, './SafetyNotice': {}, './BackButton': {}, './TeacherViewTracker': {},
  });
  const rendered = JSON.stringify(await detail.default({ params: Promise.resolve({ id: '7' }) }));
  assert.match(rendered, /test-phone/);
  assert.match(rendered, /test-wechat/);
  assert.doesNotMatch(rendered, /开通会员|单篇解锁|支付成功/);
});

test('sitemap retains listing and merchant URLs without querying retired models', async () => {
  const sitemap = loadSource('src/app/sitemap.ts', {
    '@/lib/prisma': { prisma: {
      teacher: { findMany: async () => [{ id: 7, createdAt: new Date(0) }] },
      merchant: { findMany: async () => [{ id: 8, updatedAt: new Date(0) }] },
    } },
    '@/lib/location-seo': { getSeoLocationsForRecord: () => [] },
    '@/lib/site-config': { MIN_ACCESSIBLE_LOCATION_RECORDS: 1 },
    '@/lib/site': { getCurrentSite: async () => ({}) },
    '@/lib/site-utils': { siteOrigin: () => 'https://example.test' },
  });
  const urls = (await sitemap.default()).map(({ url }) => url);
  assert.ok(urls.includes('https://example.test/listing/7'));
  assert.ok(urls.includes('https://example.test/spa/8'));
  assert.ok(urls.every(url => !/alley|vip|promote/.test(url)));
});

test('registration ignores old referral cookies while preserving account creation', async () => {
  let saved;
  const auth = loadSource('src/lib/user-auth.ts', {
    'next/headers': { cookies: () => { throw new Error('Registration must not read referral cookies'); } },
    'next/navigation': {}, jsonwebtoken: {},
    bcrypt: { default: { hash: async () => 'hashed-test-password' } },
    'node:crypto': { randomUUID: () => 'legacy-unique-value' },
    '@/lib/prisma': { prisma: { user: {
      findUnique: async ({ where }) => { assert.ok('username' in where); return null; },
      create: async ({ data }) => { saved = data; return { ...data, id: 1 }; },
    } } },
    '@/lib/user-session-cookie': {}, '@/lib/user-auth-input': {},
    '@/lib/site': { getCurrentSite: async () => ({ id: 'test-site' }) },
  }, { process: { env: { JWT_SECRET: 'test-only' } } });
  const user = await auth.registerUser({ username: 'test', password: 'test-password' }, 'unknown');
  assert.equal(user.username, 'test');
  assert.equal(saved.passwordHash, 'hashed-test-password');
  assert.equal(saved.siteId, 'test-site');
  assert.equal(saved.referralCode, 'legacy-unique-value');
  assert.equal('referredBy' in saved, false);
  assert.equal('passwordHash' in user, false);
});
