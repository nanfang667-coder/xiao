// 推广短链入口：/r/邀请码
// 查到对应用户就记一个 30 天有效的邀请 cookie，然后跳转首页。
// 真正的绑定发生在"新用户注册"那一刻（见 src/lib/user-auth.ts 的 registerUser）。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "ref_code";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });

  const res = NextResponse.redirect(new URL("/", req.url));

  if (referrer) {
    res.cookies.set(COOKIE_NAME, code, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }

  return res;
}
