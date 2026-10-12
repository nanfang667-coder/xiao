import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, 'Source must parse: ' + file);
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, URL, Date, ...globals,
    require(name) {
      assert.ok(name in mocks, 'Unexpected dependency: ' + name);
      return mocks[name];
    },
  });
  return exports;
}

const VISITOR = '11111111-1111-4111-8111-111111111111';
const NEW_VISITOR = '22222222-2222-4222-8222-222222222222';
const OTHER_VISITOR = '33333333-3333-4333-8333-333333333333';
const COOKIE = 'ref_visitor_id';
const ORIGIN = 'https://main.example.test';

function fixture({ failStats = false, failLookup = false, origin = ORIGIN } = {}) {
  const channels = new Map([
    ['gp77', { id: 'fixture-gp77', code: 'gp77', name: 'Fixture GP77', hostname: 'gp77.example.test', isActive: true }],
    ['ad_2', { id: 'fixture-ad2', code: 'ad_2', name: 'Fixture AD2', hostname: 'ad2.example.test', isActive: true }],
    ['paused', { id: 'fixture-paused', code: 'paused', name: 'Fixture paused', hostname: 'paused.example.test', isActive: false }],
  ]);
  const calls = { lookups: [], upserts: [], errors: [], cookieReads: [], forbiddenModels: [] };
  const rows = new Map();
  const prisma = {
    promotionChannel: { async findUnique(query) {
      calls.lookups.push(query);
      if (failLookup) throw new Error('Fixture lookup failure');
      return channels.get(query.where.code) ?? null;
    } },
    promotionChannelVisit: { async upsert(query) {
      calls.upserts.push(query);
      if (failStats) throw new Error('Fixture write failure');
      const key = JSON.stringify(query.where.channelId_visitorKey);
      const previous = rows.get(key);
      if (previous) {
        previous.visitCount += query.update.visitCount.increment;
        previous.lastVisitedAt = query.update.lastVisitedAt;
      } else {
        rows.set(key, { visitCount: 1, firstVisitedAt: new Date(0), lastVisitedAt: new Date(0), ...query.create });
      }
    } },
  };
  // Any accidental access to invitation, user or site models fails the test.
  for (const model of ['user', 'referralVisit', 'siteVisit', 'site']) {
    Object.defineProperty(prisma, model, { get() {
      calls.forbiddenModels.push(model);
      assert.fail('Channel visits must not access ' + model);
    } });
  }
  const visitor = load('src/lib/visitor.ts', {
    'server-only': {}, 'node:crypto': { createHash, randomUUID: () => NEW_VISITOR },
  });
  const channelsModule = load('src/lib/promotion-channel.ts', {
    'server-only': {}, 'next/server': { NextRequest, NextResponse },
    './prisma': { prisma }, './site-config': { getTrustedSiteOrigin: () => origin }, './visitor': visitor,
    './promotion-channel-input': load('src/lib/promotion-channel-input.ts', {}),
  }, { console: { error: (...args) => calls.errors.push(args) } });
  const redirect = channelsModule.promotionChannelRedirect;
  channelsModule.promotionChannelRedirect = async (...args) => {
    const response = await redirect(...args);
    assert.deepEqual(calls.forbiddenModels, [], 'Safe failure handling must not hide access to other attribution models');
    return response;
  };
  function request({ visitorId = VISITOR, host = new URL(origin).host, headers = {}, method = 'GET' } = {}) {
    const requestHeaders = new Headers(headers);
    if (host !== null) requestHeaders.set('host', host);
    return {
      method,
      headers: requestHeaders,
      nextUrl: new URL('/go/gp77?ref=XYZ&next=https://attacker.invalid', origin),
      cookies: { get(name) {
        calls.cookieReads.push(name);
        if (name === COOKIE && visitorId) return { value: visitorId };
        if (name === 'ref_code') return { value: 'AB3' };
        if (name === 'user_session') return { value: 'fixture-session' };
        return undefined;
      } },
    };
  }
  return { ...channelsModule, request, rows, calls, channelsModule, origin };
}

function assertPrivate(response) {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
}

function assertHome(response, origin = ORIGIN) {
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), origin + '/');
  assertPrivate(response);
}

test('repeat visits preserve the shared anonymous identity and update a single channel visitor', async () => {
  const f = fixture();
  const first = await f.promotionChannelRedirect(f.request(), 'gp77');
  const second = await f.promotionChannelRedirect(f.request({ visitorId: first.cookies.get(COOKIE).value }), 'gp77');
  assertHome(first);
  assertHome(second);
  assert.equal(f.rows.size, 1);
  const row = [...f.rows.values()][0];
  assert.equal(row.channelId, 'fixture-gp77');
  assert.equal(row.visitCount, 2);
  assert.equal(row.firstVisitedAt.getTime(), 0);
  assert.ok(row.lastVisitedAt instanceof Date);
  assert.equal(row.visitorKey, createHash('sha256').update(`channel:fixture-gp77:${VISITOR}`).digest('hex'));
  assert.equal(second.cookies.get(COOKIE).value, VISITOR);
});

test('different browsers count independently while the same browser can visit multiple channels', async () => {
  const f = fixture();
  await f.promotionChannelRedirect(f.request(), 'gp77');
  await f.promotionChannelRedirect(f.request({ visitorId: OTHER_VISITOR }), 'gp77');
  await f.promotionChannelRedirect(f.request(), 'ad_2');
  assert.equal(f.rows.size, 3);
  assert.equal([...f.rows.values()].filter(row => row.channelId === 'fixture-gp77').length, 2);
  assert.equal(new Set([...f.rows.values()].map(row => row.visitorKey)).size, 3);
});

test('uppercase channel links resolve to the same canonical channel without accepting whitespace', async () => {
  const f = fixture();
  assertHome(await f.promotionChannelRedirect(f.request(), 'GP77'));
  assertHome(await f.promotionChannelRedirect(f.request(), 'gp77'));
  assert.equal(f.rows.size, 1);
  assert.equal([...f.rows.values()][0].visitCount, 2);
  assert.equal((await f.promotionChannelRedirect(f.request(), ' gp77')).status, 404);
  assert.equal((await f.promotionChannelRedirect(f.request(), 'gp77 ')).status, 404);
  assert.equal(f.calls.upserts.length, 2);
});

test('a channel visit does not overwrite invitation or session cookies and stores only a hash', async () => {
  const f = fixture();
  const response = await f.promotionChannelRedirect(f.request(), 'gp77');
  assert.deepEqual(response.cookies.getAll().map(value => value.name), [COOKIE]);
  assert.ok(f.calls.cookieReads.every(name => name === COOKIE));
  assert.doesNotMatch(JSON.stringify(f.calls.upserts), new RegExp(VISITOR));
  assert.doesNotMatch(JSON.stringify(f.calls.upserts), /fixture-session|AB3|ipAddress|userAgent/);
});

test('short-domain entry moves to the main origin before reading identity or counting', async () => {
  const f = fixture();
  const first = await f.promotionChannelRedirect(f.request({ host: 'gp77.example.test' }), 'gp77');
  assert.equal(first.status, 307);
  assert.equal(first.headers.get('location'), ORIGIN + '/go/gp77');
  assertPrivate(first);
  assert.equal(first.headers.get('set-cookie'), null);
  assert.equal(f.calls.upserts.length, 0);
  assert.equal(f.calls.cookieReads.length, 0);
  const second = await f.promotionChannelRedirect(f.request(), 'gp77');
  assertHome(second);
  assert.equal(f.rows.size, 1);
  assert.equal(second.cookies.get(COOKIE).value, VISITOR);
});

test('forwarded host identifies the public origin behind a local reverse proxy', async () => {
  const f = fixture();
  const response = await f.promotionChannelRedirect(f.request({
    host: '127.0.0.1:3000', headers: { 'x-forwarded-host': 'main.example.test', 'x-forwarded-proto': 'https' },
  }), 'gp77');
  assertHome(response);
  assert.equal(f.rows.size, 1);
  assert.equal(response.cookies.get(COOKIE).secure, true);
});

test('an insecure main-host entry moves to the configured secure origin before recording', async () => {
  const f = fixture();
  const response = await f.promotionChannelRedirect(f.request({ headers: { 'x-forwarded-proto': 'http' } }), 'gp77');
  assert.equal(response.headers.get('location'), ORIGIN + '/go/gp77');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.calls.upserts.length, 0);
  assert.equal(f.calls.cookieReads.length, 0);
  assertPrivate(response);
});

test('untrusted or malformed hosts cannot select a redirect target or receive the main-site cookie', async () => {
  for (const host of ['attacker.invalid', 'main.example.test.attacker.invalid', 'main.example.test@attacker.invalid', 'main.example.test, attacker.invalid']) {
    const f = fixture();
    const response = await f.promotionChannelRedirect(f.request({ host, headers: { 'x-forwarded-host': host } }), 'gp77');
    assert.equal(response.headers.get('location'), ORIGIN + '/go/gp77', host);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(f.rows.size, 0);
    assertPrivate(response);
  }
});

test('unknown and malformed codes return private 404 responses without visits or cookies', async () => {
  for (const code of ['missing', '', 'a', '../gp77', 'gp77/extra', 'gp77?ref=AB3', 'a'.repeat(33)]) {
    const f = fixture();
    const response = await f.promotionChannelRedirect(f.request(), code);
    assert.equal(response.status, 404, code);
    assert.equal(response.headers.get('set-cookie'), null);
    assertPrivate(response);
    assert.equal(f.calls.upserts.length, 0);
    assert.equal(f.calls.cookieReads.length, 0);
    if (code !== 'missing') assert.equal(f.calls.lookups.length, 0);
  }
});

test('disabled channels safely redirect home without changing visitor identity or history', async () => {
  const f = fixture();
  const response = await f.promotionChannelRedirect(f.request(), 'paused');
  assertHome(response);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.calls.upserts.length, 0);
  assert.equal(f.calls.cookieReads.length, 0);
});

test('prefetch requests do not count or create visitor cookies', async () => {
  for (const headers of [
    { purpose: 'prefetch' }, { 'sec-purpose': 'prefetch' },
    { 'sec-purpose': 'prefetch;prerender' }, { 'next-router-prefetch': '1' },
    { 'x-middleware-prefetch': '1' },
  ]) {
    const f = fixture();
    const response = await f.promotionChannelRedirect(f.request({ headers }), 'gp77');
    assertPrivate(response);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(f.calls.upserts.length, 0);
    assert.equal(f.calls.cookieReads.length, 0);
  }
});

test('absent or malformed cookies get a new shared anonymous identifier with secure cookie options', async () => {
  for (const visitorId of [null, 'invalid-id']) {
    const f = fixture();
    const response = await f.promotionChannelRedirect(f.request({ visitorId }), 'gp77');
    assertHome(response);
    const cookie = response.cookies.get(COOKIE);
    assert.equal(cookie.value, NEW_VISITOR);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'lax');
    assert.equal(cookie.path, '/');
    assert.equal(cookie.domain, undefined);
    assert.equal(cookie.maxAge, 31536000);
    assert.equal([...f.rows.values()][0].visitorKey,
      createHash('sha256').update(`channel:fixture-gp77:${NEW_VISITOR}`).digest('hex'));
  }
});

test('local development uses the configured local origin and a non-secure visitor cookie', async () => {
  const f = fixture({ origin: 'http://localhost:3000' });
  const response = await f.promotionChannelRedirect(f.request(), 'gp77');
  assertHome(response, f.origin);
  assert.equal(response.cookies.get(COOKIE).secure, false);
});

test('statistics failures preserve safe navigation without exposing database error details', async () => {
  const f = fixture({ failStats: true });
  const response = await f.promotionChannelRedirect(f.request(), 'gp77');
  assertHome(response);
  assert.equal(f.calls.upserts.length, 1);
  assert.doesNotMatch(await response.text(), /Fixture write failure/);
  assert.equal(response.cookies.get('ref_code'), undefined);
});

test('a channel lookup failure also preserves safe navigation with no tracking changes', async () => {
  const f = fixture({ failLookup: true });
  const response = await f.promotionChannelRedirect(f.request(), 'gp77');
  assertHome(response);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.calls.upserts.length, 0);
  assert.doesNotMatch(await response.text(), /Fixture lookup failure/);
});

test('the route awaits asynchronous params and supplies an explicit HEAD that never records a visit', async () => {
  const f = fixture();
  const route = load('src/app/go/[code]/route.ts', {
    '@/lib/promotion-channel': f.channelsModule,
    '@/lib/site-config': { getTrustedSiteOrigin: () => ORIGIN },
    'next/server': { NextRequest, NextResponse },
  });
  assert.equal(typeof route.HEAD, 'function', 'Next automatically derives HEAD from GET unless overridden');
  const response = await route.GET(f.request(), { params: Promise.resolve({ code: 'gp77' }) });
  assertHome(response);
  const writes = f.calls.upserts.length;
  for (const code of ['gp77', 'missing', '../gp77']) {
    const head = await route.HEAD(f.request({ method: 'HEAD' }), { params: Promise.resolve({ code }) });
    assert.equal(f.calls.upserts.length, writes);
    assert.equal(head.headers.get('set-cookie'), null);
    assertPrivate(head);
    assert.equal(await head.text(), '');
  }
});
