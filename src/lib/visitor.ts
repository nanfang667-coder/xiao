import "server-only";

import { createHash, randomUUID } from "node:crypto";

// 沿用原邀请统计 Cookie 名，避免已经统计过的浏览器重新生成匿名标识。
export const VISITOR_COOKIE_NAME = "ref_visitor_id";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOrCreateVisitorId(value: string | undefined): string {
  return value && UUID_V4_PATTERN.test(value) ? value : randomUUID();
}

export function hashVisitorKey(visitorId: string, namespace: string): string {
  return createHash("sha256").update(`${namespace}:${visitorId}`).digest("hex");
}