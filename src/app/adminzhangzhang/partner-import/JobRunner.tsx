"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ImportProgress } from "@/lib/partner-import-types";
import { getPartnerImportErrorMessage } from "@/lib/partner-import-errors";
import { retryPartnerImport, runPartnerImportStep } from "./actions";

export function JobRunner({ jobId, initialProgress }: { jobId: string; initialProgress: ImportProgress }) {
  const [progress, setProgress] = useState(initialProgress);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const continueRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    function pauseOnLeave() {
      if (document.visibilityState === "hidden") {
        continueRef.current = false;
        setRunning(false);
      }
    }
    function pauseOnPageHide() {
      continueRef.current = false;
      setRunning(false);
    }
    document.addEventListener("visibilitychange", pauseOnLeave);
    window.addEventListener("pagehide", pauseOnPageHide);
    return () => {
      mountedRef.current = false;
      continueRef.current = false;
      document.removeEventListener("visibilitychange", pauseOnLeave);
      window.removeEventListener("pagehide", pauseOnPageHide);
    };
  }, []);

  function pause() {
    continueRef.current = false;
    setRunning(false);
  }

  function begin(retry = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    continueRef.current = true;
    setRunning(true);
    setError("");
    startTransition(async () => {
      try {
        if (retry) {
          const reset = await retryPartnerImport(jobId);
          if (!mountedRef.current) return;
          if (reset.error) {
            setError(reset.error);
            return;
          }
          setProgress(reset);
        }
        while (continueRef.current && mountedRef.current) {
          const next = await runPartnerImportStep(jobId);
          if (!mountedRef.current) return;
          if (next.error) {
            setError(next.error);
            break;
          }
          setProgress(next);
          if (next.done) break;
          // Give pause/navigation a chance to stop before starting the next item.
          await new Promise<void>((resolve) => window.setTimeout(resolve, next.queued === 0 ? 2_000 : 300));
        }
      } catch {
        if (mountedRef.current) setError("连接中断或会话已过期。请刷新页面确认进度后继续；已经完成的条目会保留。");
      } finally {
        busyRef.current = false;
        continueRef.current = false;
        if (mountedRef.current) setRunning(false);
      }
    });
  }

  const completed = progress.imported + progress.skipped + progress.failed;
  const stats = [["本页帖子", progress.total], ["待处理", progress.queued], ["处理中", progress.processing],
    ["已导入", progress.imported], ["已跳过", progress.skipped], ["失败", progress.failed]] as const;
  const status = running ? "正在逐条导入…" : pending ? "暂停中，正在完成当前请求…" : progress.done ? "本页处理完成" : "已暂停，点击继续导入";

  return <section className="rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="progress-heading">
    <h2 id="progress-heading" className="font-bold text-gray-800">导入进度</h2>
    <p className="mt-2 text-sm text-gray-700" role="status" aria-live="polite">{status}</p>
    <progress aria-label="本页处理进度" value={completed} max={Math.max(progress.total, 1)} className="mt-4 h-3 w-full accent-pink-500" />
    <div className="mt-4 grid grid-cols-3 gap-3">
      {stats.map(([label, count]) => <div key={label} className="rounded-xl bg-gray-50 p-3 text-center">
        <p className="text-xl font-bold text-gray-800">{count}</p><p className="mt-1 text-xs text-gray-500">{label}</p>
      </div>)}
    </div>
    <p className="mt-4 text-xs leading-6 text-gray-500">任务仅显示数量，不展示帖子正文。已导入的内容保存在私有待审区；重复且未变化的帖子会跳过。离开页面、切换标签或点击暂停后，已经开始的一条可能仍会完成，其余条目等待继续。</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {running ? <button type="button" onClick={pause} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">暂停导入</button>
        : <button type="button" disabled={pending || progress.done} onClick={() => begin()}
          className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "等待当前请求完成…" : "开始 / 继续导入"}</button>}
      {progress.failed > 0 && <button type="button" disabled={pending} onClick={() => begin(true)}
        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 disabled:opacity-50">重试失败条目（{progress.failed}）</button>}
      <Link href="/adminzhangzhang/partner-import#drafts" className="rounded-lg bg-pink-50 px-4 py-2 text-sm font-bold text-pink-600">前往待审区 →</Link>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {progress.failures && progress.failures.length > 0 && <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-800" aria-label="失败原因">
      {progress.failures.map(({ code, count }) => <li key={code}>{count} 条：{getPartnerImportErrorMessage(code)}</li>)}
    </ul>}
    {progress.failed > 0 && <p className="mt-3 text-xs leading-5 text-amber-800">临时网络失败可重试。本任务使用建立时的配置；若修改了采集规则或图片域名，请返回导入管理重新提交同一页网址。为保护内容，任务页不展示原始页面和响应信息。</p>}
  </section>;
}