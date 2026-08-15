import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { securityHeaders } from "./security-headers.ts";

function headerValue(name: string, nodeEnv: string): string | undefined {
  return securityHeaders(nodeEnv).find((header) => header.key === name)?.value;
}

test("sets the baseline browser security headers", () => {
  assert.equal(headerValue("X-Content-Type-Options", "production"), "nosniff");
  assert.equal(headerValue("X-Frame-Options", "production"), "DENY");
  assert.equal(headerValue("Referrer-Policy", "production"), "strict-origin-when-cross-origin");
  assert.equal(
    headerValue("Permissions-Policy", "production"),
    "camera=(), microphone=(), geolocation=()",
  );
});

test("enforces compatible CSP directives without weakening script policy", () => {
  const productionCsp = headerValue("Content-Security-Policy", "production") ?? "";
  assert.match(productionCsp, /base-uri 'self'/);
  assert.match(productionCsp, /object-src 'none'/);
  assert.match(productionCsp, /frame-ancestors 'none'/);
  assert.match(productionCsp, /form-action 'self'/);
  assert.match(productionCsp, /upgrade-insecure-requests/);
  assert.doesNotMatch(productionCsp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(
    headerValue("Content-Security-Policy", "development") ?? "",
    /upgrade-insecure-requests/,
  );
});
