import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE_NAME } from "@/lib/admin-session-token";

const ADMIN_PATH_PREFIX = "/adminzhangzhang";

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isAdminPath =
    pathname === ADMIN_PATH_PREFIX ||
    pathname.startsWith(`${ADMIN_PATH_PREFIX}/`);

  if (!isAdminPath) return NextResponse.next();

  const isLoginPage = pathname === `${ADMIN_PATH_PREFIX}/login`;
  // Proxy 只做乐观的 Cookie 存在性检查；页面和 Server Action 会查询数据库验证。
  const hasSession = req.cookies.has(ADMIN_SESSION_COOKIE_NAME);

  if (!hasSession && !isLoginPage) {
    return NextResponse.redirect(new URL(`${ADMIN_PATH_PREFIX}/login`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/adminzhangzhang/:path*"],
};
