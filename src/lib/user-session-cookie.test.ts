import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { userSessionCookieOptions } from "./user-session-cookie.ts";

test("marks user session cookies Secure only in production", () => {
  assert.equal(userSessionCookieOptions("production").secure, true);
  assert.equal(userSessionCookieOptions("development").secure, false);
  assert.equal(userSessionCookieOptions("test").secure, false);
});

test("keeps the existing user session cookie protections and lifetime", () => {
  assert.deepEqual(userSessionCookieOptions("production"), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: true,
  });
});
