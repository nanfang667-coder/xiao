import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';

function loadSource(file, mocks) {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, Date, console, require(name) {
    if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

test('unknown referral returns 404 without cookies or tracking', async () => {
  const { referralRedirect } = loadSource('src/lib/referral.ts', {
    'next/server': { NextResponse },
    './prisma': { prisma: { user: { findUnique: async () => null } } },
    './site-config': {}, './visitor': {},
  });
  const response = await referralRedirect(new NextRequest('https://example.test/missing'), 'missing');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
});

test('valid referral still redirects and records attribution', async () => {
  let visits = 0;
  const { referralRedirect } = loadSource('src/lib/referral.ts', {
    'next/server': { NextResponse },
    './prisma': { prisma: {
      user: { findUnique: async () => ({ id: 1 }) },
      referralVisit: { upsert: async () => { visits++; } },
    } },
    './site-config': { getTrustedSiteOrigin: () => 'https://example.test' },
    './visitor': { getOrCreateVisitorId: () => 'test-visitor', hashVisitorKey: () => 'test-hash',
      VISITOR_COOKIE_NAME: 'visitor_id', VISITOR_COOKIE_MAX_AGE: 60 },
  });
  const response = await referralRedirect(new NextRequest('https://example.test/AB3'), 'AB3');
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://example.test/');
  assert.equal(response.cookies.get('ref_code').value, 'AB3');
  assert.equal(visits, 1);
});

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
    '@/lib/partner-links': { getPublishedPartnerLinks: async () => [] },
    '@/lib/feature-flags': {}, './TeacherBrowser': {},
  });
  const metadata = await home.generateMetadata({ searchParams: Promise.resolve({ page: '2' }) });
  assert.equal(metadata.alternates.canonical, 'https://example.test/?page=2');
  await assert.rejects(home.default({ searchParams: Promise.resolve({ page: '999' }) }), /redirect:\/\?page=2/);
});
