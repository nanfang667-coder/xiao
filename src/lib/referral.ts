// 推广邀请相关的小助手函数：生成专属邀请码、处理邀请短链跳转。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

// 去掉容易看混的字符（0/O、1/I/L），方便用户口头或手动分享邀请码
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 3;

// 邀请码直接放在根路径下（如 gp77.top/AB3），这些是已有页面占用的路径名，
// 邀请码不能跟它们撞上（生成的码全是大写字母/数字，这里转小写做保险比较）
const RESERVED_PATHS = ["admin", "login", "promote", "r", "register", "teacher", "vip", "uploads"];

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// 生成一个全站唯一的邀请码（极小概率冲突时重试几次）
export async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    if (RESERVED_PATHS.includes(code.toLowerCase())) continue;
    const exists = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  throw new Error("生成邀请码失败，请重试");
}

// ========== 邀请短链跳转 ==========

const REF_COOKIE_NAME = "ref_code";
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

// 查到对应用户就记一个 30 天有效的邀请 cookie，然后跳转首页。
// 真正的绑定发生在"新用户注册"那一刻（见 src/lib/user-auth.ts 的 registerUser）。
export async function referralRedirect(req: NextRequest, code: string) {
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });

  // 不能直接用 req.url 拼跳转地址：开发环境用 `-H 0.0.0.0` 启动时，
  // req.url 里的域名是绑定地址 0.0.0.0，而不是浏览器访问时用的域名，
  // 会导致跳转到打不开的 http://0.0.0.0:3000/。改用请求头里的真实 Host。
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const res = NextResponse.redirect(`${proto}://${host}/`);

  if (referrer) {
    res.cookies.set(REF_COOKIE_NAME, code, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE,
    });
  }

  return res;
}
