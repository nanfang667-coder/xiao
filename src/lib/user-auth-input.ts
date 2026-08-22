export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;
export const LOGIN_IDENTIFIER_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const GENERIC_LOGIN_ERROR = "账号或密码不正确";

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function stringField(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateRegistrationForm(
  formData: FormData,
): ValidationResult<{ username: string; password: string }> {
  const rawUsername = stringField(formData.get("username"));
  const password = stringField(formData.get("password"));
  const confirmPassword = stringField(formData.get("confirmPassword"));

  if (rawUsername === null || password === null || confirmPassword === null) {
    return { success: false, error: "请填写所有字段" };
  }

  const username = rawUsername.trim().normalize("NFKC");
  if (!username || !password || !confirmPassword) {
    return { success: false, error: "请填写所有字段" };
  }
  if (
    username.length < USERNAME_MIN_LENGTH ||
    username.length > USERNAME_MAX_LENGTH
  ) {
    return {
      success: false,
      error: `用户名需为 ${USERNAME_MIN_LENGTH} 到 ${USERNAME_MAX_LENGTH} 个字符`,
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      success: false,
      error: "用户名只能包含中文、字母、数字、点、下划线或短横线",
    };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      success: false,
      error: `密码至少 ${PASSWORD_MIN_LENGTH} 位字符`,
    };
  }
  if (utf8Length(password) > PASSWORD_MAX_BYTES) {
    return { success: false, error: "密码过长，请缩短后重试" };
  }
  if (password !== confirmPassword) {
    return { success: false, error: "两次输入的密码不一致" };
  }

  return { success: true, data: { username, password } };
}

export function validateLoginForm(
  formData: FormData,
): ValidationResult<{ usernameOrEmail: string; password: string }> {
  const rawIdentifier = stringField(formData.get("usernameOrEmail"));
  const password = stringField(formData.get("password"));
  if (rawIdentifier === null || password === null) {
    return { success: false, error: GENERIC_LOGIN_ERROR };
  }

  const usernameOrEmail = rawIdentifier.trim();
  if (
    !usernameOrEmail ||
    !password ||
    usernameOrEmail.length > LOGIN_IDENTIFIER_MAX_LENGTH ||
    utf8Length(password) > PASSWORD_MAX_BYTES
  ) {
    return { success: false, error: GENERIC_LOGIN_ERROR };
  }

  return { success: true, data: { usernameOrEmail, password } };
}
