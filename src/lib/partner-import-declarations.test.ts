import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { stripPartnerDeclarationText, cleanPartnerImportFields } from "./partner-import-declarations.ts";

test("exact declaration headings remove their full tail with either colon or line ending", () => {
  for (const marker of ["声明信息", " 声明信息： ", "声明信息:虚构声明", "声明信息：虚构声明"]) {
    for (const newline of ["\n", "\r\n", "\r"]) {
      assert.equal(stripPartnerDeclarationText("虚构服务" + newline + marker + newline + "虚构声明续行"), "虚构服务");
      assert.equal(stripPartnerDeclarationText(marker + newline + "虚构声明续行"), "");
    }
  }
});
test("ordinary mentions and unmatched formatting remain unchanged", () => {
  for (const text of ["说明中提到声明信息。", "声明信息说明：普通文字", "  虚构服务\r\n第二行  ", "阅读声明信息：相关说明"]) {
    assert.equal(stripPartnerDeclarationText(text), text);
  }
});
test("field cleanup copies only known text fields and leaves title, category and photos alone", () => {
  const original = { name: "声明信息", type: "钢琴", services: "服务甲\n声明信息\n虚构声明",
    phone: "声明信息：不是电话", age: "28", address: null, photos: ["synthetic.jpg"], unknown: "声明信息\n保留" };
  const result = cleanPartnerImportFields(original);
  assert.notEqual(result, original);
  assert.equal(result.services, "服务甲");
  assert.equal(result.phone, "");
  assert.equal(original.services, "服务甲\n声明信息\n虚构声明");
  assert.equal(result.name, original.name);
  assert.equal(result.type, original.type);
  assert.equal(result.photos, original.photos);
  assert.equal(result.address, null);
  assert.equal(result.unknown, original.unknown);
  assert.deepEqual(cleanPartnerImportFields(result), result);
});
