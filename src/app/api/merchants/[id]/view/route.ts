import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";

  try {
    const url = new URL(origin);
    // Next.js may use its bind address (0.0.0.0) in nextUrl behind a proxy.
    // Host retains the address the browser actually requested, including its port.
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid merchant id" }, { status: 400 });
  }

  try {
    const result = await prisma.merchant.updateMany({
      where: { id, isPublished: true },
      data: { viewCount: { increment: 1 } },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Tracking unavailable" }, { status: 503 });
  }

  return new NextResponse(null, { status: 204 });
}
