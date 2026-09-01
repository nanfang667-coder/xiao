import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { withAlleyTitleSuffix } from "./alley-title.ts";

test("appends 站街 to a city title", () => {
  assert.equal(withAlleyTitleSuffix("天津"), "天津站街");
});

test("does not append 站街 twice", () => {
  assert.equal(withAlleyTitleSuffix("天津站街"), "天津站街");
});

test("keeps an empty title empty", () => {
  assert.equal(withAlleyTitleSuffix(""), "");
});
