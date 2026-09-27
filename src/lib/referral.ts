import "server-only";

import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getTrustedSiteOrigin } from "./site-config";
import {
  getOrCreateVisitorId,
  hashVisitorKey,
  VISITOR_COOKIE_MAX_AGE,
  VISITOR_COOKIE_NAME,
} from "./visitor";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 3;
const RESERVED_PATHS = new Set([
  "admin", "adminzhangzhang", "alley", "api", "fenglou", "listing", "login",
  "promote", "r", "register", "safety", "spa", "teacher", "team", "uploads", "vip",
]);
const SHORT_CODE_PATTERN = /^[a-z0-9]{3,32}$/i;
const UUID_CODE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REF_COOKIE_NAME = "ref_code";
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// 保留已经发出的原码，同时兼容短码大小写和误删功能期间生成的 UUID 码。
export async function findReferralOwner(code: string) {
  if (RESERVED_PATHS.has(code.toLowerCase())) return null;
  const isUuid = UUID_CODE_PATTERN.test(code);
  if (!isUuid && !SHORT_CODE_PATTERN.test(code)) return null;

  const select = { id: true, siteId: true, referralCode: true } as const;
  const exact = await prisma.user.findUnique({ where: { referralCode: code }, select });
  if (exact) return exact;

  const canonical = isUuid ? code.toLowerCase() : code.toUpperCase();
  if (canonical === code) return null;
  return prisma.user.findUnique({ where: { referralCode: canonical }, select });
}

export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (RESERVED_PATHS.has(code.toLowerCase())) continue;
    const existing = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error("生成邀请码失败，请重试");
}

export async function referralRedirect(req: NextRequest, code: string) {
  const referrer = await findReferralOwner(code);
  if (!referrer) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex", "Cache-Control": "private, no-store" },
    });
  }

  // 跳转地址来自站点配置，不能使用请求中的 Host 或任意外部地址。
  const siteOrigin = getTrustedSiteOrigin();
  const response = NextResponse.redirect(new URL("/", siteOrigin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  const secure = new URL(siteOrigin).protocol === "https:";
  const visitorId = getOrCreateVisitorId(req.cookies.get(VISITOR_COOKIE_NAME)?.value);
  // 延用原有邀请人命名空间，已有浏览器继续命中历史统计行。
  const visitorKey = hashVisitorKey(visitorId, String(referrer.id));

  try {
    await prisma.referralVisit.upsert({
      where: { referrerId_visitorKey: { referrerId: referrer.id, visitorKey } },
      create: { referrerId: referrer.id, visitorKey },
      update: { visitCount: { increment: 1 }, lastVisitedAt: new Date() },
    });
  } catch (error) {
    // 统计失败不阻断链接访问和注册来源绑定。
    console.error("Failed to record referral visit", error);
  }

  response.cookies.set(REF_COOKIE_NAME, referrer.referralCode, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: REF_COOKIE_MAX_AGE, secure,
  });
  response.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: VISITOR_COOKIE_MAX_AGE, secure,
  });
  return response;
}
