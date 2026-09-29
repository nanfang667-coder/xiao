export const TRANSFER_FILE_FORMAT = "partner-drafts-v1";
const MAX_LINE = 18 * 1024 * 1024;
export class TransferFileError extends Error {}
export type TransferCounts = { imported: number; skipped: number; total: number };
export async function uploadTransferFile(file: File, sourceId: string, onProgress: (counts: TransferCounts) => void,
  send: typeof fetch = fetch): Promise<TransferCounts> {
  if (!file.size || file.size > 1024 * 1024 * 1024 || !/^[1-9]\d*$/.test(sourceId)) throw new TransferFileError("请选择来源和有效的中转文件。");
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const counts = { imported: 0, skipped: 0, total: 0 };
  let pending = "", received = 0, ended = false;
  async function consume(line: string) {
    if (!line.trim()) return;
    if (new TextEncoder().encode(line).length > MAX_LINE) throw new TransferFileError("中转文件的单条数据过大。");
    let record;
    try { record = JSON.parse(line); } catch { throw new TransferFileError("中转文件不完整，请重新导出。"); }
    if (!record || record.format !== TRANSFER_FILE_FORMAT || ended) throw new TransferFileError("中转文件格式不正确。");
    if (!counts.total) {
      if (record.kind !== "header" || !Number.isInteger(record.count) || record.count < 1 || record.count > 50) throw new TransferFileError("中转文件格式不正确。");
      counts.total = record.count;
      onProgress({ ...counts });
      return;
    }
    if (record.kind === "end") {
      if (record.count !== counts.total || received !== counts.total) throw new TransferFileError("中转文件不完整，请重新导出。");
      ended = true;
      return;
    }
    if (record.kind !== "post" || received >= counts.total) throw new TransferFileError("中转文件格式不正确。");
    let response: Response;
    try {
      response = await send("/adminzhangzhang/partner-import/transfer?sourceId=" + sourceId,
        { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: line });
    } catch { throw new TransferFileError("上传中断，请检查网络后重试；已成功的条目会自动跳过。"); }
    if (!response.ok || response.redirected) {
      if (response.status === 401) throw new TransferFileError("登录已失效，请重新登录后上传。");
      if (response.status === 413) throw new TransferFileError("服务器上传大小限制不足，请联系管理员调整后重试。");
      throw new TransferFileError("上传失败，请确认所选来源与本地一致、文件完整后重试；已成功的条目会自动跳过。");
    }
    const result = await response.json().catch(() => null);
    if (!result || !["imported", "skipped"].includes(result.status)) throw new TransferFileError("上传未确认，请重新上传重试。");
    if (result.status === "imported") counts.imported++;
    else counts.skipped++;
    received++;
    onProgress({ ...counts });
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const current = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        await consume(current);
      }
      if (pending.length > MAX_LINE) throw new TransferFileError("中转文件的单条数据过大。");
      if (done) break;
    }
    if (pending.trim()) await consume(pending);
    if (!ended) throw new TransferFileError("中转文件不完整，请重新导出；已成功的条目会保留。");
    return counts;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
