import { prisma } from "@/lib/prisma";
import { fulfillPaidOrder } from "@/lib/payment";
import { verifyQianheNotification } from "@/lib/qianhe-payment";

const MAX_NOTIFICATION_BYTES = 16 * 1024;

function reply(body: "SUCCESS" | "FAIL", status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return reply("FAIL", 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NOTIFICATION_BYTES) {
    return reply("FAIL", 413);
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length === 0 || text.length > MAX_NOTIFICATION_BYTES) return reply("FAIL", 413);
    payload = JSON.parse(text);
  } catch {
    return reply("FAIL", 400);
  }

  try {
    const notification = verifyQianheNotification(payload);

    // 平台文档定义 2 为支付成功；其它已验签状态不发放权益。
    if (notification.state !== 2) return reply("SUCCESS");

    const order = await prisma.order.findUnique({
      where: { merchantOrderNo: notification.merchantOrderNo },
      select: { id: true },
    });
    if (!order) return reply("FAIL", 404);

    const result = await fulfillPaidOrder({
      orderId: order.id,
      paidAmountCents: notification.amountCents,
      providerTradeNo: notification.tradeNo,
    });

    return result === "paid" || result === "already_paid"
      ? reply("SUCCESS")
      : reply("FAIL", 409);
  } catch {
    // 不向外暴露验签、配置或数据库细节；非 SUCCESS 会让平台按文档重试。
    return reply("FAIL", 400);
  }
}
