import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteParams = {
  params: Promise<{ id: string }>;
};

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

export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid teacher id" }, { status: 400 });
  }

  try {
    const result = await prisma.teacher.updateMany({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("Failed to record teacher view", error);
    return NextResponse.json({ error: "Tracking unavailable" }, { status: 503 });
  }

  return new NextResponse(null, { status: 204 });
}
