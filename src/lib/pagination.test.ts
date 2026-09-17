import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's TypeScript runner requires the explicit extension.
import { parsePage, pageUrl } from "./pagination.ts";

test("invalid and missing page numbers resolve to the first page", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    assert.equal(parsePage(value), 1);
  }
});

test("pagination preserves distinct canonical URLs for later pages", () => {
  assert.equal(pageUrl("/", parsePage("2")), "/?page=2");
  assert.equal(pageUrl("/", parsePage("1")), "/");
  assert.equal(pageUrl("/fenglou/example", parsePage(["3", "4"])), "/fenglou/example?page=3");
});
