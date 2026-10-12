"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ImportActionState } from "@/lib/partner-import-types";
import { deletePartnerImportJob } from "./actions";

type JobRow = {
  id: string;
  sourceName: string;
  createdLabel: string;
  itemCount: number;
};
type DeleteJobState = ImportActionState & { deletedJobIds?: string[]; attemptedJobId?: string };

export function JobList({ jobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [state, action, pending] = useActionState<DeleteJobState, FormData>(async (previous, form) => {
    const jobId = form.get("jobId");
    if (typeof jobId !== "string" || jobId !== confirmation || form.get("confirmDelete") !== "yes") {
      return { ...previous, error: "请先确认要删除的任务记录。", message: undefined };
    }
    try {
      const result = await deletePartnerImportJob(form);
      if (!result.error && result.deletedJobId === jobId) {
        setConfirmation(null);
        router.refresh();
        return { ...result, attemptedJobId: jobId,
          deletedJobIds: [...new Set([...(previous.deletedJobIds ?? []), jobId])] };
      }
      return { ...result, error: result.error ?? "删除未完成，请刷新后重试。",
        message: undefined, attemptedJobId: jobId, deletedJobIds: previous.deletedJobIds };
    } catch {
      return { error: "删除失败，请稍后重试。", attemptedJobId: jobId, deletedJobIds: previous.deletedJobIds };
    }
  }, {});
  const deleted = new Set(state.deletedJobIds ?? []);
  const rows = jobs.filter(job => !deleted.has(job.id));

  return <div className="mt-3">
    <div aria-live="polite">
      {state.message && <p role="status" className="mb-3 text-sm text-emerald-700">{state.message}</p>}
    </div>
    <div className="divide-y divide-gray-100">
      {rows.map(job => {
        const confirming = confirmation === job.id;
        const headingId = `delete-job-${job.id}`;
        return <div key={job.id} className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/adminzhangzhang/partner-import/jobs/${job.id}`} prefetch={false}
              className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-gray-800">{job.sourceName}</p>
                <p className="mt-1 text-xs text-gray-500">{job.createdLabel} · {job.itemCount} 条</p>
              </div>
              <span className="text-sm text-pink-600">查看进度 →</span>
            </Link>
            <button type="button" disabled={pending} aria-expanded={confirming}
              aria-controls={confirming ? `${headingId}-confirmation` : undefined}
              aria-label={`删除任务记录：${job.sourceName}，${job.createdLabel}`}
              onClick={() => setConfirmation(job.id)}
              className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50">删除记录</button>
          </div>
          {confirming && <form id={`${headingId}-confirmation`} action={action} onSubmit={event => {
            if (pending || confirmation !== job.id) event.preventDefault();
          }} className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" aria-labelledby={headingId}>
            <input type="hidden" name="jobId" value={job.id} />
            <p id={headingId} className="text-sm font-semibold text-red-800">确认删除这条任务记录？</p>
            <p className="mt-1 text-xs leading-5 text-red-700">只清理任务记录，未完成的条目将不再继续导入。已导入的待审帖子、图片及已发布帖子都会保留。</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="submit" name="confirmDelete" value="yes" disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {pending ? "正在删除…" : "确认删除记录"}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirmation(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 disabled:opacity-50">取消</button>
            </div>
            {pending && <p role="status" className="mt-2 text-xs text-gray-600">正在删除任务记录，请稍候…</p>}
            {state.error && state.attemptedJobId === job.id && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
          </form>}
        </div>;
      })}
      {rows.length === 0 && <p className="py-5 text-sm text-gray-500">还没有导入任务。</p>}
    </div>
  </div>;
}
