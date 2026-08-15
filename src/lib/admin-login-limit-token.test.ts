import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { ADMIN_LOGIN_GLOBAL_FAILURE_LIMIT, ADMIN_LOGIN_IP_FAILURE_LIMIT, ADMIN_LOGIN_WINDOW_MS, createAdminLoginLimitBuckets, isAdminPasswordValid } from "./admin-login-limit-token.ts";

test("creates private fixed-window IP and global throttle keys", () => {
  const now = new Date("2026-08-14T00:01:00.000Z");
  const buckets = createAdminLoginLimitBuckets(
    "203.0.113.10",
    "test-secret",
    now,
  );
  const expectedExpiry =
    Math.floor(now.getTime() / ADMIN_LOGIN_WINDOW_MS) * ADMIN_LOGIN_WINDOW_MS +
    ADMIN_LOGIN_WINDOW_MS;

  assert.deepEqual(
    buckets.map((bucket) => bucket.scope),
    ["ip", "global"],
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.limit),
    [ADMIN_LOGIN_IP_FAILURE_LIMIT, ADMIN_LOGIN_GLOBAL_FAILURE_LIMIT],
  );
  assert.equal(buckets[0].keyHash.length, 64);
  assert.doesNotMatch(buckets[0].keyHash, /203\.0\.113\.10/);
  assert.equal(buckets[0].expiresAt.getTime(), expectedExpiry);
});

test("changes the IP key across clients and time windows", () => {
  const firstWindow = new Date("2026-08-14T00:01:00.000Z");
  const nextWindow = new Date(firstWindow.getTime() + ADMIN_LOGIN_WINDOW_MS);
  const first = createAdminLoginLimitBuckets(
    "203.0.113.10",
    "test-secret",
    firstWindow,
  );
  const otherIp = createAdminLoginLimitBuckets(
    "203.0.113.11",
    "test-secret",
    firstWindow,
  );
  const later = createAdminLoginLimitBuckets(
    "203.0.113.10",
    "test-secret",
    nextWindow,
  );

  assert.notEqual(first[0].keyHash, otherIp[0].keyHash);
  assert.notEqual(first[0].keyHash, later[0].keyHash);
  assert.equal(first[1].keyHash, otherIp[1].keyHash);
});

test("compares administrator passwords without length-dependent equality", () => {
  assert.equal(isAdminPasswordValid("correct horse", "correct horse"), true);
  assert.equal(isAdminPasswordValid("wrong", "correct horse"), false);
  assert.equal(isAdminPasswordValid("anything", undefined), false);
});
