import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateVisitorId,
  hashVisitorKey,
  VISITOR_COOKIE_MAX_AGE,
  VISITOR_COOKIE_NAME,
} from "@/lib/visitor";

function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");

  if (host && origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  return req.headers.get("sec-fetch-site") === "same-origin";
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existingVisitorId = req.cookies.get(VISITOR_COOKIE_NAME)?.value;
  const visitorId = getOrCreateVisitorId(existingVisitorId);
  const visitorKey = hashVisitorKey(visitorId, "site");

  try {
    await prisma.siteVisit.upsert({
      where: { visitorKey },
      create: { visitorKey },
      update: {
        visitCount: { increment: 1 },
        lastVisitedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Failed to record site visit", error);
    return NextResponse.json({ error: "Tracking unavailable" }, { status: 503 });
  }

  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
    secure: proto === "https",
  });
  return response;
}