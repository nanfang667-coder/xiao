"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TransferFileError, uploadTransferFile, type TransferCounts } from "@/lib/partner-import-transfer-client";

export function TransferUpload({ sources }: { sources: { id: number; name: string; origin: string }[] }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [counts, setCounts] = useState<TransferCounts | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
    <h2 className="font-bold text-gray-800">上传本地中转文件</h2>
    <p className="mt-2 text-sm leading-6 text-gray-500">先在本地完成导入，在任务页点击“下载中转文件”，再到正式站选择同一来源并上传。文字和照片只进入待初审，不会自动发布。</p>
    <form className="mt-3 space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (busy.current) return;
      const form = new FormData(event.currentTarget);
      const file = form.get("transferFile");
      if (!(file instanceof File)) return;
      busy.current = true; setPending(true); setError(""); setMessage(""); setCounts(null);
      try {
        const result = await uploadTransferFile(file, String(form.get("sourceId") ?? ""), setCounts);
        setMessage("上传完成：新增 " + result.imported + " 条，重复跳过 " + result.skipped + " 条。请到待初审列表查看。");
        router.refresh();
      } catch (failure) {
        setError(failure instanceof TransferFileError
          ? failure.message : "中转文件无法读取，请重新导出后上传。");
      } finally { busy.current = false; setPending(false); }
    }}>
      <fieldset disabled={pending || !sources.length} className="space-y-3">
        <label className="block text-sm text-gray-700">选择正式站来源
          <select name="sourceId" required className="mt-1 w-full rounded-lg border border-gray-200 p-2">
            {sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.origin}</option>)}
          </select>
        </label>
        <label className="block text-sm text-gray-700">中转文件
          <input type="file" name="transferFile" accept=".jsonl" required className="mt-1 block w-full text-sm" />
        </label>
        <button className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "正在上传…" : "上传到待审区"}</button>
      </fieldset>
      {!sources.length && <p className="text-sm text-amber-700">请先在来源配置中添加与本地相同的合作方域名。</p>}
      {counts && <p role="status" className="text-sm text-gray-500">已处理 {counts.imported + counts.skipped} / {counts.total} 条，新增 {counts.imported} 条，跳过 {counts.skipped} 条。</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  </section>;
}
