import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { resolveAlleyImportLocation } from "./locations.ts";

test("matches regular city names to province and canonical city", () => {
  assert.deepEqual(resolveAlleyImportLocation("武汉"), {
    province: "湖北省",
    district: "武汉市",
  });
  assert.deepEqual(resolveAlleyImportLocation("广州市"), {
    province: "广东省",
    district: "广州市",
  });
  assert.deepEqual(resolveAlleyImportLocation("西安"), {
    province: "陕西省",
    district: "西安市",
  });
});

test("keeps municipality district empty instead of guessing a county", () => {
  assert.deepEqual(resolveAlleyImportLocation("天津"), {
    province: "天津市",
    district: "",
  });
  assert.deepEqual(resolveAlleyImportLocation("重庆市"), {
    province: "重庆市",
    district: "",
  });
});

test("returns undefined when a city cannot be identified", () => {
  assert.equal(resolveAlleyImportLocation("未知城市"), undefined);
});