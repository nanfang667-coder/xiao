import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { getTrustedSiteOrigin, SITE_URL } from "./site-config.ts";

test("uses the canonical site origin in production", () => {
  assert.equal(getTrustedSiteOrigin("production"), SITE_URL);
  assert.equal(new URL(getTrustedSiteOrigin("production")).protocol, "https:");
});

test("uses a fixed local origin outside production", () => {
  assert.equal(getTrustedSiteOrigin("development"), "http://localhost:3000");
  assert.equal(getTrustedSiteOrigin("test"), "http://localhost:3000");
});
