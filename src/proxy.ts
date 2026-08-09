import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PATH_PREFIX = "/adminzhangzhang";

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isAdminPath =
    pathname === ADMIN_PATH_PREFIX ||
    pathname.startsWith(`${ADMIN_PATH_PREFIX}/`);

  if (!isAdminPath) return NextResponse.next();

  const isLoginPage = pathname === `${ADMIN_PATH_PREFIX}/login`;
  const session = req.cookies.get("admin_session")?.value;
  const loggedIn = session === process.env.ADMIN_SESSION_SECRET;

  if (!loggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL(`${ADMIN_PATH_PREFIX}/login`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/adminzhangzhang/:path*"],
};
