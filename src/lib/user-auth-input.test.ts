import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { GENERIC_LOGIN_ERROR, validateLoginForm, validateRegistrationForm } from "./user-auth-input.ts";

function registrationForm(
  username: string,
  password: string,
  confirmPassword = password,
): FormData {
  const formData = new FormData();
  formData.set("username", username);
  formData.set("password", password);
  formData.set("confirmPassword", confirmPassword);
  return formData;
}

test("normalizes and accepts a bounded Chinese username", () => {
  const result = validateRegistrationForm(
    registrationForm("  测试用户_01  ", "correct-horse"),
  );
  assert.deepEqual(result, {
    success: true,
    data: { username: "测试用户_01", password: "correct-horse" },
  });
});

test("rejects registration usernames outside the allowed format", () => {
  const result = validateRegistrationForm(
    registrationForm("user name", "correct-horse"),
  );
  assert.equal(result.success, false);
});

test("rejects registration passwords longer than bcrypt's byte limit", () => {
  const result = validateRegistrationForm(registrationForm("test-user", "密".repeat(25)));
  assert.deepEqual(result, { success: false, error: "密码过长，请缩短后重试" });
});

test("uses one generic error for missing and oversized login inputs", () => {
  const missing = new FormData();
  const oversized = new FormData();
  oversized.set("usernameOrEmail", "a".repeat(255));
  oversized.set("password", "password");

  assert.deepEqual(validateLoginForm(missing), {
    success: false,
    error: GENERIC_LOGIN_ERROR,
  });
  assert.deepEqual(validateLoginForm(oversized), {
    success: false,
    error: GENERIC_LOGIN_ERROR,
  });
});

test("keeps legacy short passwords valid for login", () => {
  const formData = new FormData();
  formData.set("usernameOrEmail", "existing-user");
  formData.set("password", "123456");

  assert.deepEqual(validateLoginForm(formData), {
    success: true,
    data: { usernameOrEmail: "existing-user", password: "123456" },
  });
});
