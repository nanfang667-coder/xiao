// 访问守卫：所有 /admin 下的页面，未登录就跳到登录页。
// （登录页 /admin/login 本身除外，否则没法登录）

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const isLoginPage = req.nextUrl.pathname === "/admin/login";
  const session = req.cookies.get("admin_session")?.value;
  const loggedIn = session === process.env.ADMIN_SESSION_SECRET;

  if (!loggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
