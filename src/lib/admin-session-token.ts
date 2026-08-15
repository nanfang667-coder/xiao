import { createHash, randomBytes } from "node:crypto";

export const ADMIN_SESSION_COOKIE_NAME = "admin_session_v2";
export const ADMIN_SESSION_LEGACY_COOKIE_NAME = "admin_session";
export const ADMIN_SESSION_COOKIE_PATH = "/adminzhangzhang";
export const ADMIN_SESSION_LEGACY_COOKIE_PATH = "/";
export const ADMIN_SESSION_COOKIES_TO_CLEAR = [
  { name: ADMIN_SESSION_LEGACY_COOKIE_NAME, path: ADMIN_SESSION_LEGACY_COOKIE_PATH },
  { name: ADMIN_SESSION_COOKIE_NAME, path: ADMIN_SESSION_COOKIE_PATH },
] as const;
export const ADMIN_SESSION_TTL_SECONDS = 24 * 60 * 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createAdminSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isAdminSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function hashAdminSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}