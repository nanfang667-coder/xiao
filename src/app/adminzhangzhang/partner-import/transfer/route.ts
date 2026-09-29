import { isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { readTransferBody } from "@/lib/partner-import-transfer-format";
import { exportTransferredJob, receiveTransferredDraft } from "@/lib/partner-import-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

export async function GET(request: Request) {
  if (!(await isAdmin())) return error("请先登录管理员后台。", 401);
  try {
    const jobId = new URL(request.url).searchParams.get("job") ?? "";
    const stream = await exportTransferredJob(jobId);
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="partner-import-' + jobId + '.jsonl"' } });
  } catch {
    return error("无法导出。请先完成本地导入；仅导出该任务中仍待初审的草稿。", 400);
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return error("登录已失效，请重新登录后上传。", 401);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    if (!origin || new URL(origin).host !== host || !["https:", "http:"].includes(new URL(origin).protocol)) {
      return error("请从本站后台上传中转文件。", 403);
    }
  } catch { return error("请从本站后台上传中转文件。", 403); }
  try {
    const rawId = new URL(request.url).searchParams.get("sourceId") ?? "";
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) throw new Error("INVALID_TRANSFER");
    const input = await readTransferBody(request);
    const status = await receiveTransferredDraft(Number(rawId), input);
    // A completed private import stays successful even if refreshing the list fails.
    try { revalidatePath("/adminzhangzhang/partner-import"); } catch {}
    return Response.json({ status }, { headers });
  } catch {
    return error("此条导入失败。请确认来源域名一致、文件完整，图片为 JPEG/PNG/WebP 且符合大小限制。可重新上传，已成功的条目会自动跳过。", 400);
  }
}
