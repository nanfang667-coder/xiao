import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';

function load(file, mocks = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, console, process: { env: { NODE_ENV: 'production' } },
    require(name) { assert.ok(name in mocks, name); return mocks[name]; },
  });
  return exports;
}
const config = load('src/lib/site-config.ts');

test('only approved public hosts select an HTTPS invitation destination', () => {
  for (const host of ['fenglou2.com', 'www.fenglou2.com', 'FENGLOU2.COM:443', 'fenglou2.com:80']) {
    assert.equal(config.getReferralSiteOrigin(new Headers({ host })), 'https://fenglou2.com');
  }
  for (const host of ['fenglou1.com', 'evil.example', 'fenglou2.com.evil.example', 'fenglou2.com@evil.example', 'fenglou2.com, evil.example', 'fenglou2.com:1234']) {
    assert.equal(config.getReferralSiteOrigin(new Headers({ host })), 'https://fenglou1.com');
  }
  assert.equal(config.getReferralSiteOrigin(new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'fenglou2.com', 'x-forwarded-proto': 'http' })), 'https://fenglou2.com');
  assert.equal(config.getReferralSiteOrigin(new Headers({ host: 'localhost:3000' }), 'development'), 'http://localhost:3000');
});

function handler(owner, failStats = false) {
  const visits = [];
  const referral = load('src/lib/referral.ts', {
    'server-only': {}, 'node:crypto': {}, 'next/server': { NextRequest, NextResponse },
    './site-config': config,
    './prisma': { prisma: {
      user: { findUnique: async () => owner },
      referralVisit: { upsert: async (value) => { visits.push(value); if (failStats) throw new Error('test'); } },
    } },
    './visitor': {
      getOrCreateVisitorId: () => 'test-visitor', hashVisitorKey: () => 'test-key',
      VISITOR_COOKIE_MAX_AGE: 3600, VISITOR_COOKIE_NAME: 'visitor_id',
    },
  });
  return { ...referral, visits };
}

for (const host of ['fenglou1.com', 'fenglou2.com']) {
  test(`${host} invitation retains domain, attribution and secure cookies`, async () => {
    const app = handler({ id: 42, siteId: 'a', referralCode: 'HEV' });
    const response = await app.referralRedirect(new NextRequest(`http://localhost:3000/HEV`, {
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'http' },
    }), 'HEV');
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `https://${host}/`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.cookies.get('ref_code').value, 'HEV');
    assert.equal(response.cookies.get('ref_code').secure, true);
    assert.equal(response.cookies.get('ref_code').domain, undefined);
    assert.equal(app.visits.length, 1);
    assert.equal(app.visits[0].create.referrerId, 42);
  });
}
test('unknown invitation remains 404 and records no visit', async () => {
  const app = handler(null);
  const response = await app.referralRedirect(new NextRequest('https://fenglou2.com/XYZ'), 'XYZ');
  assert.equal(response.status, 404);
  assert.equal(app.visits.length, 0);
});
