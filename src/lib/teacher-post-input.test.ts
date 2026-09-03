import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { extractTeacherPostFields } from "./teacher-post-input.ts";

test("extractTeacherPostFields trims values and normalizes empty optional fields", () => {
  const form = new FormData();
  form.set("name", "  示例帖子  ");
  form.set("services", "  服务说明  ");
  form.set("wechat", " wx-123 ");
  form.set("qq", "   ");

  const result = extractTeacherPostFields(form);
  assert.equal(result.name, "示例帖子");
  assert.equal(result.services, "服务说明");
  assert.equal(result.wechat, "wx-123");
  assert.equal(result.qq, null);
});

test("extractTeacherPostFields rejects a post without contact details", () => {
  const form = new FormData();
  form.set("name", "示例帖子");
  form.set("services", "服务说明");

  assert.throws(() => extractTeacherPostFields(form), /contact method/);
});

test("extractTeacherPostFields accepts an alternative contact method", () => {
  const form = new FormData();
  form.set("name", "示例帖子");
  form.set("services", "服务说明");
  form.set("otherContact", "example@example.com");

  assert.equal(
    extractTeacherPostFields(form).otherContact,
    "example@example.com",
  );
});
