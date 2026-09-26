import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, Date, ...globals, require(name) {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return exports;
}

const backofficePaths = [
  '/team', '/team/', '/team/login', '/team/posts/new', '/team/posts/17/edit',
  '/adminzhangzhang', '/adminzhangzhang/', '/adminzhangzhang/login', '/adminzhangzhang/users',
];
const publicPaths = ['/', '/listing/49', '/spa', '/spa/7', '/teamwork', '/adminzhangzhang-info'];
const policy = () => load('src/lib/visitor-tracking.ts', {});

test('backoffice classification uses complete path segments and preserves public routes', () => {
  const { isBackofficePath } = policy();
  for (const pathname of backofficePaths) assert.equal(isBackofficePath(pathname), true, pathname);
  for (const pathname of publicPaths) assert.equal(isBackofficePath(pathname), false, pathname);
});

function tracker({ offline = false } = {}) {
  let pathname;
  let previousDependencies;
  const requests = [];
  const { SiteVisitTracker } = load('src/components/SiteVisitTracker.tsx', {
    react: { useEffect(effect, dependencies) {
      if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) {
        previousDependencies = dependencies;
        effect();
      }
    } },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/visitor-tracking': policy(),
  }, { fetch: async (url, options) => {
    requests.push({ url, ...options });
    if (offline) throw new Error('Fixture network failure');
    return { ok: true };
  } });
  return {
    requests,
    navigate(nextPathname) { pathname = nextPathname; assert.equal(SiteVisitTracker(), null); },
  };
}

test('client never sends tracking requests for backoffice or unresolved paths', () => {
  const fixture = tracker();
  for (const pathname of [null, undefined, '', ...backofficePaths]) fixture.navigate(pathname);
  assert.equal(fixture.requests.length, 0);
});

test('client continues tracking public pages with the existing request options', () => {
  const fixture = tracker();
  for (const pathname of publicPaths) fixture.navigate(pathname);
  assert.equal(fixture.requests.length, publicPaths.length);
  for (const request of fixture.requests) {
    assert.deepEqual(request, {
      url: '/api/visits', method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
    });
  }
});

test('client resumes tracking after navigating from backoffice to the public site', () => {
  const fixture = tracker();
  fixture.navigate('/team/login');
  fixture.navigate('/team');
  assert.equal(fixture.requests.length, 0);
  fixture.navigate('/');
  assert.equal(fixture.requests.length, 1);
  fixture.navigate('/');
  assert.equal(fixture.requests.length, 1, 'Unchanged pathname must not retrigger the effect');
  fixture.navigate('/adminzhangzhang/users');
  fixture.navigate('/listing/49');
  assert.equal(fixture.requests.length, 2);
});

test('client tolerates tracking failures without disrupting page navigation', async () => {
  const fixture = tracker({ offline: true });
  fixture.navigate('/');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.requests.length, 1);
});

const EXISTING_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '22222222-2222-4222-8222-222222222222';
const COOKIE = 'ref_visitor_id';

function route({ databaseFails = false } = {}) {
  const calls = { sites: [], cookies: [], ids: [], hashes: [], writes: [], errors: [] };
  const { POST } = load('src/app/api/visits/route.ts', {
    'next/server': { NextResponse },
    '@/lib/visitor-tracking': policy(),
    '@/lib/site': { getSiteByHostname: async (host) => { calls.sites.push(host); return { id: 17 }; } },
    '@/lib/visitor': {
      VISITOR_COOKIE_NAME: COOKIE,
      VISITOR_COOKIE_MAX_AGE: 31536000,
      getOrCreateVisitorId(value) { calls.ids.push(value); return value || NEW_ID; },
      hashVisitorKey(value, namespace) { calls.hashes.push({ value, namespace }); return `${namespace}|${value}`; },
    },
    '@/lib/prisma': { prisma: { siteVisit: { upsert: async (query) => {
      calls.writes.push(query);
      if (databaseFails) throw new Error('Fixture database unavailable');
    } } } },
  }, { console: { error: (...args) => calls.errors.push(args) } });
  function request(pathname = '/', { host = 'example.test', origin = 'https://example.test',
    nextUrl = 'https://example.test/api/visits', referer, visitorId, headers = {},
  } = {}) {
    const requestHeaders = new Headers(headers);
    if (host !== null) requestHeaders.set('host', host);
    if (origin !== null) requestHeaders.set('origin', origin);
    requestHeaders.set('referer', referer ?? `https://example.test${pathname}`);
    return {
      headers: requestHeaders, nextUrl: new URL(nextUrl),
      cookies: { get(name) { calls.cookies.push(name); return visitorId ? { value: visitorId } : undefined; } },
    };
  }
  return { POST, request, calls };
}

function assertSkipped(fixture, response, status = 204) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('set-cookie'), null);
  for (const key of ['sites', 'cookies', 'ids', 'hashes', 'writes']) {
    assert.equal(fixture.calls[key].length, 0, `${key} must remain untouched`);
  }
}

test('API ignores all backoffice requests before resolving sites, reading cookies or writing visitors', async () => {
  for (const pathname of backofficePaths) {
    const fixture = route();
    assertSkipped(fixture, await fixture.POST(fixture.request(pathname)));
  }
});

test('API uses external Host behind a reverse proxy to exclude backoffice requests', async () => {
  for (const pathname of ['/team/login', '/team/posts/new', '/adminzhangzhang/users']) {
    const fixture = route();
    assertSkipped(fixture, await fixture.POST(fixture.request(pathname, {
      nextUrl: 'http://127.0.0.1:3000/api/visits', headers: { 'x-forwarded-proto': 'https' },
    })));
  }
});

test('API falls back to nextUrl host when Host is absent and same-origin fetch metadata is present', async () => {
  const fixture = route();
  assertSkipped(fixture, await fixture.POST(fixture.request('/team', {
    host: null, origin: null, headers: { 'sec-fetch-site': 'same-origin' },
  })));
});

test('API keeps rejecting cross-origin and malformed-origin requests before any visitor access', async () => {
  for (const origin of ['https://other.test', 'https://example.test:444', 'not-a-url']) {
    const fixture = route();
    const response = await fixture.POST(fixture.request('/team', { origin }));
    assertSkipped(fixture, response, 403);
    assert.equal((await response.json()).error, 'Forbidden');
  }
  const fixture = route();
  assertSkipped(fixture, await fixture.POST(fixture.request('/', {
    origin: null, headers: { 'sec-fetch-site': 'cross-site' },
  })), 403);
});

test('API records public visits with the existing visitor identity and atomic activity update', async () => {
  const fixture = route();
  for (const pathname of ['/', '/listing/49', '/spa']) {
    const response = await fixture.POST(fixture.request(pathname, { visitorId: EXISTING_ID }));
    assert.equal(response.status, 204);
    const cookie = response.cookies.get(COOKIE);
    assert.equal(cookie.value, EXISTING_ID);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'lax');
    assert.equal(cookie.path, '/');
    assert.equal(cookie.secure, true);
    assert.equal(cookie.maxAge, 31536000);
  }
  assert.deepEqual(fixture.calls.sites, ['example.test', 'example.test', 'example.test']);
  assert.deepEqual(fixture.calls.ids, [EXISTING_ID, EXISTING_ID, EXISTING_ID]);
  assert.equal(fixture.calls.writes.length, 3);
  for (const query of fixture.calls.writes) {
    assert.equal(query.where.visitorKey, `site:17|${EXISTING_ID}`);
    assert.equal(query.create.visitorKey, query.where.visitorKey);
    assert.equal(query.create.siteId, 17);
    assert.deepEqual(Object.keys(query.update).sort(), ['lastVisitedAt', 'visitCount']);
    assert.equal(query.update.visitCount.increment, 1);
    assert.ok(query.update.lastVisitedAt instanceof Date);
  }
});

test('API creates a visitor for public paths without confusing similar prefixes or unrelated referers', async () => {
  for (const options of [
    { pathname: '/teamwork' },
    { pathname: '/adminzhangzhang-info' },
    { pathname: '/', referer: 'https://other.test/team' },
  ]) {
    const fixture = route();
    const response = await fixture.POST(fixture.request(options.pathname, options));
    assert.equal(response.status, 204);
    assert.equal(response.cookies.get(COOKIE).value, NEW_ID);
    assert.equal(fixture.calls.writes.length, 1);
    assert.equal(fixture.calls.writes[0].create.visitorKey, `site:17|${NEW_ID}`);
    assert.deepEqual(fixture.calls.hashes, [{ value: NEW_ID, namespace: 'site:17' }]);
  }
});

test('API returns a retryable failure without setting a visitor cookie when storage fails', async () => {
  const fixture = route({ databaseFails: true });
  const response = await fixture.POST(fixture.request('/listing/49'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).error, 'Tracking unavailable');
  assert.equal(fixture.calls.writes.length, 1);
  assert.equal(fixture.calls.errors.length, 1);
});
