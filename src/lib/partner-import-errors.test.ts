import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { getPartnerImportErrorMessage, isPartnerImportDiagnosticCode } from "./partner-import-errors.ts";

const knownCodes = [
  "INVALID_URL", "ORIGIN_NOT_ALLOWED", "UNSAFE_ADDRESS", "DNS_FAILED", "CONNECT_FAILED",
  "TLS_FAILED", "TIMEOUT", "HTTP_STATUS", "CONTENT_TYPE", "UNSUPPORTED_ENCODING", "TOO_LARGE",
  "REDIRECT_LIMIT", "INVALID_RESPONSE", "INVALID_RULES", "HTML_ENCODING", "LISTING_NO_MATCH",
  "LISTING_NO_SAFE_LINKS", "TOO_MANY_POSTS", "DETAIL_MISSING_FIELDS", "DETAIL_AMBIGUOUS_FIELDS", "DETAIL_LIMIT",
];

// Synthetic values only: no network, database, source content, or environment access.
test("every recognized import failure has fixed, actionable text", () => {
  const fallback = getPartnerImportErrorMessage("IMPORT_FAILED");
  for (const code of knownCodes) {
    assert.notEqual(getPartnerImportErrorMessage(code), fallback, code);
    assert.equal(isPartnerImportDiagnosticCode(code), true, code);
  }
  assert.equal(isPartnerImportDiagnosticCode("IMPORT_FAILED"), true);
  assert.match(getPartnerImportErrorMessage("LISTING_NO_MATCH", 200), /调整.*帖子链接选择器/);
  assert.match(getPartnerImportErrorMessage("UNSAFE_ADDRESS"), /DNS.*代理.*保留.*安全检查/);
  assert.match(getPartnerImportErrorMessage("TLS_FAILED"), /保留证书验证/);
});

test("HTTP status messages distinguish authorization, missing pages, rate limits, and server failures", () => {
  for (const status of [401, 403]) {
    assert.match(getPartnerImportErrorMessage("HTTP_STATUS", status), new RegExp(`HTTP ${status}.*合作方授权`));
  }
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 404), /页面不存在/);
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 429), /访问频率/);
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 503), /HTTP 503.*稍后重试/);
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 302), /HTTP 302/);
});

test("only integer HTTP statuses from 100 through 599 may appear in messages", () => {
  const fallback = getPartnerImportErrorMessage("HTTP_STATUS");
  for (const status of [undefined, null, false, "403", "PRIVATE_STATUS", NaN, Infinity, -Infinity, 0, 99, 600, 403.5,
    {}, [], Symbol("PRIVATE_STATUS"), { toString() { throw new Error("must not coerce status"); } }]) {
    assert.equal(getPartnerImportErrorMessage("HTTP_STATUS", status), fallback);
  }
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 100), /HTTP 100/);
  assert.match(getPartnerImportErrorMessage("HTTP_STATUS", 599), /HTTP 599/);
  assert.equal(getPartnerImportErrorMessage("DNS_FAILED", 403), getPartnerImportErrorMessage("DNS_FAILED"));
});

test("unknown codes and exception objects cannot leak private values or inherited properties", () => {
  const fallback = getPartnerImportErrorMessage("IMPORT_FAILED");
  for (const code of [undefined, null, false, 403, "", "constructor", "toString", "__proto__",
    "https://private.example/PRIVATE_TITLE?token=PRIVATE_SECRET", "<script>PRIVATE_BODY</script>",
    new Error("PRIVATE_BODY"), {}, [], Symbol("PRIVATE_SECRET"),
    { toString() { throw new Error("must not coerce code"); } }]) {
    assert.equal(getPartnerImportErrorMessage(code, 403), fallback);
    assert.equal(isPartnerImportDiagnosticCode(code), false);
  }
});
