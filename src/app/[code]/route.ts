// 推广短链入口：域名直接跟邀请码，例如 gp77.top/AB3
// 查到对应用户就记一个 30 天有效的邀请 cookie，然后跳转首页。
// 真正的绑定发生在"新用户注册"那一刻（见 src/lib/user-auth.ts 的 registerUser）。

import { NextRequest } from "next/server";
import { referralRedirect } from "@/lib/referral";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return referralRedirect(req, code);
}
