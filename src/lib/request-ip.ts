// 获取当前请求的客户端 IP，用于限流。
// 生产环境跑在 Nginx 反向代理后面，必须由 Nginx 转发真实 IP。
//
// 【为什么取最后一个，而不是第一个】
// 本项目 Nginx 配的是 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;（追加模式），
// 不是替换模式——它只会在客户端发来的头后面追加一段，不会清空客户端自己塞的内容。
// 如果直接取第一个值，攻击者只要自己在请求里带一个假的 X-Forwarded-For 头（比如伪造成别人的IP），
// 就能让这假IP排在最前面，绕过限流、甚至嫁祸给无辜用户被误封。
// Nginx 自己追加的那一段永远在最后，且不受客户端控制，所以必须取最后一个才是可信的真实IP。
// （前提：Nginx 是这条链路上唯一的反代，没有 CDN 之类的中间层；这个前提当前成立。）
//
// 【保险机制】如果 Nginx 没转发这个头，应用拿到的会是 Nginx 自己的回环地址（127.0.0.1），
// 所有访客都长一个样——这时限流会把全站访客关进同一个桶，一个人超限所有人遭殃。
// 所以这里把"拿不到 IP"和"回环地址"统一归为 "unknown"，调用方约定对 "unknown" 跳过限流/封号，
// 宁可这层防护暂时失效，也绝不误伤正常用户。

import { headers } from "next/headers";

// 回环地址：说明请求是从本机（通常就是没配转发的 Nginx）发来的，不代表真实访客
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const raw =
    h.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "";

  if (!raw || LOOPBACK_IPS.has(raw)) return "unknown";
  return raw;
}
