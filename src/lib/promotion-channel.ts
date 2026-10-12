import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { isPromotionChannelCode } from "./promotion-channel-input";
import { getTrustedSiteOrigin } from "./site-config";
import {
  getOrCreateVisitorId,
  hashVisitorKey,
  VISITOR_COOKIE_MAX_AGE,
  VISITOR_COOKIE_NAME,
} from "./visitor";

function uncached(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function isPrefetch(req: NextRequest) {
  return req.headers.has("next-router-prefetch") ||
    req.headers.has("x-middleware-prefetch") ||
    /prefetch/i.test(`${req.headers.get("purpose") ?? ""} ${req.headers.get("sec-purpose") ?? ""}`);
}

export async function promotionChannelRedirect(req: NextRequest, rawCode: string) {
  const code = rawCode.toLowerCase();
  if (!isPromotionChannelCode(code)) {
    return uncached(new NextResponse(req.method === "HEAD" ? null : "Not Found", { status: 404 }));
  }

  const origin = new URL(getTrustedSiteOrigin());
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host)
    .trim().toLowerCase();
  const protocol = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", ""))
    .trim().toLowerCase();
  // 在统一主站上读取/设置匿名 Cookie；短域名及旧域名不能先生成另一个访客 ID。
  if (host !== origin.host || `${protocol}:` !== origin.protocol) {
    return uncached(NextResponse.redirect(new URL(`/go/${code}`, origin)));
  }

  const home = () => uncached(NextResponse.redirect(new URL("/", origin)));
  let channel;
  try {
    channel = await prisma.promotionChannel.findUnique({
      where: { code }, select: { id: true, isActive: true },
    });
  } catch {
    // 包括迁移尚未完成的情况：统计暂不可用时仍允许访问主站。
    console.error("Promotion channel lookup unavailable");
    return home();
  }
  if (!channel) {
    return uncached(new NextResponse(req.method === "HEAD" ? null : "Not Found", { status: 404 }));
  }
  if (!channel.isActive || req.method !== "GET" || isPrefetch(req)) return home();

  const visitorId = getOrCreateVisitorId(req.cookies.get(VISITOR_COOKIE_NAME)?.value);
  const visitorKey = hashVisitorKey(visitorId, `channel:${channel.id}`);
  try {
    await prisma.promotionChannelVisit.upsert({
      where: { channelId_visitorKey: { channelId: channel.id, visitorKey } },
      create: { channelId: channel.id, visitorKey },
      update: { visitCount: { increment: 1 }, lastVisitedAt: new Date() },
    });
  } catch {
    console.error("Promotion channel visit recording unavailable");
  }

  const response = home();
  response.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: VISITOR_COOKIE_MAX_AGE,
    secure: origin.protocol === "https:",
  });
  return response;
}
