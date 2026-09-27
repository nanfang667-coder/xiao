import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';

function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, 'Source must parse: ' + file);
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, URL, Date, ...globals, require(name) {
    assert.ok(name in mocks, 'Unexpected dependency (payment and commission modules are not allowed): ' + name);
    return mocks[name];
  } });
  return exports;
}

const VISITOR = '11111111-1111-4111-8111-111111111111';
const NEW_VISITOR = '22222222-2222-4222-8222-222222222222';
const UUID_CODE = '33333333-3333-4333-8333-333333333abc';
const COOKIE = 'ref_visitor_id';

function fixture({ failStats = false, origin = 'https://example.test', randomValues = [] } = {}) {
  const users = new Map([
    ['AB3', { id: 7, siteId: 'a', referralCode: 'AB3' }],
    ['QX8', { id: 8, siteId: 'a', referralCode: 'QX8' }],
    [UUID_CODE, { id: 9, siteId: 'a', referralCode: UUID_CODE }],
    ['XY7', { id: 10, siteId: 'b', referralCode: 'XY7' }],
  ]);
  const calls = { lookups: [], upserts: [], errors: [], created: [] };
  const rows = new Map();
  const prisma = {
    user: {
      async findUnique({ where }) {
        calls.lookups.push(where);
        return 'referralCode' in where ? (users.get(where.referralCode) ?? null) : null;
      },
      async create({ data }) { calls.created.push(data); return { id: 20, ...data }; },
    },
    referralVisit: { async upsert(query) {
      calls.upserts.push(query);
      if (failStats) throw new Error('Fixture write failed');
      const key = JSON.stringify(query.where.referrerId_visitorKey);
      const previous = rows.get(key);
      if (previous) {
        previous.visitCount += query.update.visitCount.increment;
        previous.lastVisitedAt = query.update.lastVisitedAt;
      } else {
        rows.set(key, { ...query.create, visitCount: 1, firstVisitedAt: new Date(0) });
      }
    } },
  };
  const visitor = load('src/lib/visitor.ts', {
    'server-only': {}, 'node:crypto': { createHash, randomUUID: () => NEW_VISITOR },
  });
  const referral = load('src/lib/referral.ts', {
    'server-only': {}, 'node:crypto': { randomInt: () => randomValues.shift() ?? 0 },
    'next/server': { NextResponse }, './prisma': { prisma },
    './site-config': { getTrustedSiteOrigin: () => origin }, './visitor': visitor,
  }, { console: { error: (...args) => calls.errors.push(args) } });
  const request = (id = VISITOR) => ({
    headers: new Headers({ host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid' }),
    nextUrl: new URL('https://attacker.invalid/AB3'),
    cookies: { get: name => name === COOKIE && id ? { value: id } : undefined },
  });
  return { referral, visitor, prisma, request, calls, rows };
}

function cookie(response, name) { return response.cookies.get(name); }

test('repeated visits reuse the historical anonymous key and update one channel row', async () => {
  const f = fixture();
  const first = await f.referral.referralRedirect(f.request(), 'AB3');
  const second = await f.referral.referralRedirect(f.request(cookie(first, COOKIE).value), 'AB3');
  assert.equal(first.status, 307);
  assert.equal(second.status, 307);
  assert.equal(f.rows.size, 1);
  const row = [...f.rows.values()][0];
  assert.equal(row.visitCount, 2);
  assert.equal(row.firstVisitedAt.getTime(), 0);
  assert.equal(row.visitorKey, createHash('sha256').update(`7:${VISITOR}`).digest('hex'));
  assert.ok(row.lastVisitedAt instanceof Date);
  assert.equal(cookie(second, COOKIE).value, VISITOR);
});

test('the same browser is independently attributed to each invitation code', async () => {
  const f = fixture();
  await f.referral.referralRedirect(f.request(), 'AB3');
  const second = await f.referral.referralRedirect(f.request(), 'QX8');
  assert.equal(f.rows.size, 2);
  const rows = [...f.rows.values()];
  assert.notEqual(rows[0].visitorKey, rows[1].visitorKey);
  assert.deepEqual(rows.map(row => row.referrerId), [7, 8]);
  assert.equal(cookie(second, 'ref_code').value, 'QX8');
});

test('short-code case variants and existing UUID codes resolve without changing stored codes', async () => {
  const f = fixture();
  const lower = await f.referral.referralRedirect(f.request(), 'ab3');
  assert.equal(cookie(lower, 'ref_code').value, 'AB3');
  const uuid = await f.referral.referralRedirect(f.request(), UUID_CODE);
  const upperUuid = await f.referral.referralRedirect(f.request(), UUID_CODE.toUpperCase());
  assert.equal(uuid.status, 307);
  assert.equal(cookie(uuid, 'ref_code').value, UUID_CODE);
  assert.equal(cookie(upperUuid, 'ref_code').value, UUID_CODE);
  assert.equal(f.rows.size, 2);
  assert.equal(f.calls.created.length, 0);
});

test('unknown, malformed and reserved codes are 404 without statistics or cookies', async () => {
  for (const code of ['ZZ9', '', '../AB3', 'a'.repeat(100), 'team', 'api', 'spa', 'vip', 'PROMOTE']) {
    const f = fixture();
    const response = await f.referral.referralRedirect(f.request(), code);
    assert.equal(response.status, 404, code);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.equal(f.calls.upserts.length, 0);
    if (code !== 'ZZ9') assert.equal(f.calls.lookups.length, 0, code);
  }
});

test('redirects use the trusted site origin and non-cacheable secure cookies', async () => {
  const f = fixture();
  const response = await f.referral.referralRedirect(f.request(), 'AB3');
  assert.equal(response.headers.get('location'), 'https://example.test/');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  for (const name of [COOKIE, 'ref_code']) {
    const value = cookie(response, name);
    assert.equal(value.httpOnly, true);
    assert.equal(value.sameSite, 'lax');
    assert.equal(value.path, '/');
    assert.equal(value.secure, true);
  }
  assert.equal(cookie(response, COOKIE).maxAge, 31536000);
  assert.equal(cookie(response, 'ref_code').maxAge, 2592000);
  const local = fixture({ origin: 'http://localhost:3000' });
  assert.equal(cookie(await local.referral.referralRedirect(local.request(), 'AB3'), COOKIE).secure, false);
});

test('missing or invalid visitor cookies generate a valid anonymous ID before recording', async () => {
  for (const id of [undefined, 'arbitrary-value']) {
    const f = fixture();
    const response = await f.referral.referralRedirect(f.request(id ?? null), 'AB3');
    assert.equal(cookie(response, COOKIE).value, NEW_VISITOR);
    assert.equal([...f.rows.values()][0].visitorKey,
      createHash('sha256').update(`7:${NEW_VISITOR}`).digest('hex'));
  }
});

test('statistics failures preserve the safe redirect and referral attribution cookie', async () => {
  const f = fixture({ failStats: true });
  const response = await f.referral.referralRedirect(f.request(), 'AB3');
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://example.test/');
  assert.equal(cookie(response, 'ref_code').value, 'AB3');
  assert.equal(f.calls.errors.length, 1);
});

test('both current and legacy route handlers await asynchronous params', async () => {
  for (const file of ['src/app/[code]/route.ts', 'src/app/r/[code]/route.ts']) {
    const f = fixture();
    const route = load(file, { '@/lib/referral': f.referral });
    const response = await route.GET(f.request(), { params: Promise.resolve({ code: 'ab3' }) });
    assert.equal(response.status, 307);
    assert.equal(cookie(response, 'ref_code').value, 'AB3');
    assert.equal(f.rows.size, 1);
  }
});

test('new short-code generation retries a collision and returns an available code', async () => {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const f = fixture({ randomValues: [...'AB3'].map(char => alphabet.indexOf(char)) });
  assert.equal(await f.referral.generateUniqueReferralCode(), '222');
  assert.deepEqual(f.calls.lookups.map(query => query.referralCode), ['AB3', '222']);
});

async function register(refCode) {
  const f = fixture();
  const auth = load('src/lib/user-auth.ts', {
    'next/headers': { cookies: async () => ({ get: name => name === 'ref_code' && refCode ? { value: refCode } : undefined }) },
    'next/navigation': {}, jsonwebtoken: {},
    bcrypt: { default: { hash: async () => 'fixture-hash' } },
    '@/lib/prisma': { prisma: f.prisma }, '@/lib/referral': f.referral,
    '@/lib/user-session-cookie': {}, '@/lib/user-auth-input': {},
    '@/lib/site': { getCurrentSite: async () => ({ id: 'a' }) },
  }, { process: { env: { JWT_SECRET: 'fixture-only' } } });
  const user = await auth.registerUser({ username: 'fixture-user', password: 'fixture-password' }, 'unknown');
  return { user, data: f.calls.created[0], calls: f.calls };
}

test('registration binds valid same-site referral sources and supports UUID codes', async () => {
  for (const [code, expectedId] of [['AB3', 7], ['ab3', 7], [UUID_CODE, 9]]) {
    const { user, data } = await register(code);
    assert.equal(data.referredBy, expectedId);
    assert.equal(data.referralCode, '222');
    assert.equal(data.passwordHash, 'fixture-hash');
    assert.equal(data.isMember, false);
    assert.equal(data.siteId, 'a');
    assert.equal('passwordHash' in user, false);
  }
});

test('registration without a valid same-site source leaves attribution empty', async () => {
  for (const code of [undefined, 'ZZ9', 'XY7', '../AB3']) {
    const { data, calls } = await register(code);
    assert.equal(data.referredBy, null);
    assert.equal(data.referralCode, '222');
    assert.equal(calls.upserts.length, 0, 'Registration is not a short-link visit');
  }
});
