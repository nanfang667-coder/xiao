import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, Date, console, process: { env: { NODE_ENV: 'production' } },
    require(name) { assert.ok(name in mocks, 'Unexpected dependency: ' + name); return mocks[name]; },
  });
  return exports;
}

const config = load('src/lib/site-config.ts');
const utils = load('src/lib/site-utils.ts');
const defaultSite = Object.freeze({
  id: 'existing-default-site', hostname: 'fenglou1.com', name: 'Stored name',
  singlePostPrice: 11, membershipPrice: 39, membershipOriginalPrice: 59,
});

function siteApi({ fallback = defaultSite, sites = {}, host = 'husil.world' } = {}) {
  const queries = [];
  const api = load('src/lib/site.ts', {
    'server-only': {}, react: { cache: fn => fn },
    'next/headers': { headers: async () => new Headers({ host: 'localhost:3000', 'x-forwarded-host': host }) },
    '@/lib/site-config': config, '@/lib/site-utils': utils,
    '@/lib/prisma': { prisma: { site: { findFirst: async query => {
      queries.push(query);
      return query.where.isDefault ? fallback : (sites[query.where.hostname] ?? null);
    } } } },
  });
  return { ...api, queries };
}

test('target aliases keep the existing default identity and prices without looking up a separate site', async () => {
  for (const host of ['husil.world', 'www.husil.world', ' HUSIL.WORLD:443 ', 'www.husil.world:80']) {
    const api = siteApi();
    const site = await api.getSiteByHostname(host);
    assert.equal(site.id, defaultSite.id);
    assert.equal(site.hostname, 'husil.world');
    assert.equal(site.name, config.SITE_NAME);
    for (const field of ['singlePostPrice', 'membershipPrice', 'membershipOriginalPrice']) {
      assert.equal(site[field], defaultSite[field]);
    }
    assert.equal(api.queries.length, 1);
    assert.equal(api.queries[0].where.isDefault, true);
    assert.equal(api.queries[0].where.isActive, true);
    assert.equal(api.queries[0].orderBy.createdAt, 'asc');
  }
  assert.equal(defaultSite.hostname, 'fenglou1.com');
});

test('the alias uses the current default record and retains the existing fallback behavior', async () => {
  const changedDefault = { ...defaultSite, id: 'another-default', hostname: 'primary.example', name: 'Existing brand' };
  const site = await siteApi({ fallback: changedDefault }).getCurrentSite();
  assert.equal(site.id, changedDefault.id);
  assert.equal(site.name, changedDefault.name);
  assert.equal(site.hostname, 'husil.world');
  const empty = await siteApi({ fallback: null }).getCurrentSite();
  assert.equal(empty.id, utils.FALLBACK_SITE.id);
  assert.equal(empty.hostname, 'husil.world');
  assert.equal(utils.FALLBACK_SITE.hostname, 'fenglou1.com');
});

test('existing domain matches and unknown-host fallback are unchanged', async () => {
  for (const hostname of ['fenglou1.com', 'fenglou2.com', 'sjeeqw.fit', 'zollot.world', 'gp77.top']) {
    const existing = { ...defaultSite, id: 'site-for-' + hostname, hostname };
    const api = siteApi({ sites: { [hostname]: existing } });
    const site = await api.getSiteByHostname(hostname);
    assert.equal(site.id, existing.id);
    assert.equal(site.hostname, hostname);
    assert.equal(api.queries.length, 1);
    assert.equal(api.queries[0].where.hostname, hostname);
  }
  const site = await siteApi().getSiteByHostname('unrecognized.example');
  assert.equal(site.id, defaultSite.id);
  assert.equal(site.hostname, defaultSite.hostname);
  assert.equal(config.SITE_URL, 'https://fenglou1.com');
  assert.equal(config.getTrustedSiteOrigin('production'), 'https://fenglou1.com');
});

test('only the explicit target host can select its public origin', () => {
  for (const host of ['husil.world.evil.example', 'evil.husil.world', 'husil.world@evil.example',
    'husil.world, evil.example', 'husil.world:3000', 'https://husil.world', null, undefined]) {
    assert.equal(config.getDefaultSiteAliasHostname(host), null);
  }
  assert.equal(config.getReferralSiteOrigin(new Headers({
    host: 'husil.world', 'x-forwarded-host': 'evil.example',
  })), 'https://fenglou1.com');
});

test('target-domain login and referral registration retain the default account namespace', async () => {
  const api = siteApi();
  const userRow = { id: 8, siteId: defaultSite.id, username: 'existing-user',
    email: null, isMember: false, membershipExpiresAt: null, passwordHash: 'synthetic-hash' };
  let loginQuery, registered, writtenCookie;
  const auth = load('src/lib/user-auth.ts', {
    'next/headers': { cookies: async () => ({
      get: name => name === 'ref_code' ? { value: 'ABC' } : undefined,
      set: (...args) => { writtenCookie = args; },
    }) },
    'next/navigation': {},
    jsonwebtoken: { default: { sign: () => 'synthetic-token' } },
    bcrypt: { default: { compare: async () => true, hash: async () => 'synthetic-new-hash' } },
    '@/lib/prisma': { prisma: { user: {
      findFirst: async query => { loginQuery = query; return userRow; },
      findUnique: async () => null,
      create: async ({ data }) => { registered = data; return { ...data, id: 9 }; },
    } } },
    '@/lib/referral': { REF_COOKIE_NAME: 'ref_code', generateUniqueReferralCode: async () => 'NEW',
      findReferralOwner: async () => ({ id: 42, siteId: defaultSite.id }) },
    '@/lib/user-session-cookie': { userSessionCookieOptions: () => ({ secure: true }) },
    '@/lib/user-auth-input': {}, '@/lib/site': api,
  });
  assert.equal((await auth.loginUser({ usernameOrEmail: 'existing-user', password: 'synthetic' })).id, 8);
  assert.equal(loginQuery.where.siteId, defaultSite.id);
  assert.equal(writtenCookie[0], 'user_token');
  await auth.registerUser({ username: 'new-user', password: 'synthetic' }, 'unknown');
  assert.equal(registered.siteId, defaultSite.id);
  assert.equal(registered.referredBy, 42);
});

test('target and www generate target-domain canonical, metadata, robots and sitemap URLs', async () => {
  for (const host of ['husil.world', 'www.husil.world']) {
    const api = siteApi({ host });
    const shared = { '@/lib/site': api, '@/lib/site-utils': utils };
    const layout = load('src/app/layout.tsx', {
      ...shared, 'react/jsx-runtime': {}, '@/components/SiteVisitTracker': {}, './globals.css': {},
    });
    const metadata = await layout.generateMetadata();
    assert.equal(metadata.metadataBase.origin, 'https://husil.world');
    assert.equal(metadata.openGraph.url, 'https://husil.world');
    const home = load('src/app/page.tsx', {
      ...shared, 'react/jsx-runtime': {}, 'next/navigation': {},
      '@/lib/pagination': load('src/lib/pagination.ts'), '@/lib/teachers': {},
      '@/lib/user-auth': {}, '@/lib/location-seo': {}, './TeacherBrowser': {},
    });
    assert.equal((await home.generateMetadata({ searchParams: Promise.resolve({ page: '2' }) }))
      .alternates.canonical, 'https://husil.world/?page=2');
    const robots = load('src/app/robots.ts', shared);
    assert.equal((await robots.default()).sitemap, 'https://husil.world/sitemap.xml');
    const sitemap = load('src/app/sitemap.ts', {
      ...shared, '@/lib/site-config': config,
      '@/lib/prisma': { prisma: {
        teacher: { findMany: async () => [{ id: 7, createdAt: new Date(0) }] },
        merchant: { findMany: async () => [{ id: 8, updatedAt: new Date(0) }] },
      } },
      '@/lib/location-seo': { getSeoLocationsForRecord: () => [] },
    });
    const urls = (await sitemap.default()).map(({ url }) => url);
    assert.ok(urls.includes('https://husil.world/listing/7'));
    assert.ok(urls.includes('https://husil.world/spa/8'));
    assert.ok(urls.every(url => new URL(url).origin === 'https://husil.world'));
  }
});
