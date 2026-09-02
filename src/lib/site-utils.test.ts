import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidMoney,
  normalizeHostname,
  siteOrigin,
// @ts-expect-error Node's built-in TypeScript test runner requires the explicit extension.
} from "./site-utils.ts";

test("normalizes trusted hostname forms without accepting arbitrary input", () => {
  assert.equal(normalizeHostname("Example.COM:443"), "example.com");
  assert.equal(normalizeHostname("example.com, proxy.invalid"), "example.com");
  assert.equal(normalizeHostname("bad host"), null);
  assert.equal(normalizeHostname("example.com/path"), null);
});

test("uses HTTPS for public sites and HTTP only for local development", () => {
  assert.equal(siteOrigin({ hostname: "example.com" }, "production"), "https://example.com");
  assert.equal(siteOrigin({ hostname: "localhost" }, "development"), "http://localhost");
});

test("validates configurable prices", () => {
  assert.equal(isValidMoney(10), true);
  assert.equal(isValidMoney(0), false);
  assert.equal(isValidMoney(Number.NaN), false);
});
