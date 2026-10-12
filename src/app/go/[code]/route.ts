import { NextRequest } from "next/server";
import { promotionChannelRedirect } from "@/lib/promotion-channel";

type Context = { params: Promise<{ code: string }> };

export async function GET(req: NextRequest, context: Context) {
  const { code } = await context.params;
  return promotionChannelRedirect(req, code);
}

// 显式处理 HEAD，避免 Next.js 自动运行 GET 时将探测请求记入访客数。
export async function HEAD(req: NextRequest, context: Context) {
  const { code } = await context.params;
  return promotionChannelRedirect(req, code);
}
