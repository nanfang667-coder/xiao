import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIES_TO_CLEAR, ADMIN_SESSION_COOKIE_PATH, ADMIN_SESSION_LEGACY_COOKIE_NAME, ADMIN_SESSION_LEGACY_COOKIE_PATH, createAdminSessionToken, hashAdminSessionToken, isAdminSessionToken } from "./admin-session-token.ts";

test("uses distinct names and clears both legacy and current admin cookies", () => {
  assert.equal(ADMIN_SESSION_LEGACY_COOKIE_NAME, "admin_session");
  assert.equal(ADMIN_SESSION_COOKIE_NAME, "admin_session_v2");
  assert.notEqual(ADMIN_SESSION_LEGACY_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME);
  assert.equal(ADMIN_SESSION_LEGACY_COOKIE_PATH, "/");
  assert.equal(ADMIN_SESSION_COOKIE_PATH, "/adminzhangzhang");
  assert.deepEqual(ADMIN_SESSION_COOKIES_TO_CLEAR, [
    { name: ADMIN_SESSION_LEGACY_COOKIE_NAME, path: ADMIN_SESSION_LEGACY_COOKIE_PATH },
    { name: ADMIN_SESSION_COOKIE_NAME, path: ADMIN_SESSION_COOKIE_PATH },
  ]);
});

test("creates independent 256-bit base64url session tokens", () => {
  const first = createAdminSessionToken();
  const second = createAdminSessionToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("hashes tokens deterministically without storing the token itself", () => {
  const token = createAdminSessionToken();
  const hash = hashAdminSessionToken(token);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashAdminSessionToken(token));
  assert.notEqual(hash, token);
});

test("rejects malformed session tokens before database lookup", () => {
  assert.equal(isAdminSessionToken(""), false);
  assert.equal(isAdminSessionToken("too-short"), false);
  assert.equal(isAdminSessionToken("a".repeat(42) + "!"), false);
  assert.equal(isAdminSessionToken(createAdminSessionToken()), true);
});