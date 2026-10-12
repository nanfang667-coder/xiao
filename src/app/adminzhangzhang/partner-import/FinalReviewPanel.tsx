"use client";

import { useActionState, useState } from "react";
import type { ImportActionState } from "@/lib/partner-import-types";
import { DraftForm, type DraftFormProps } from "./DraftForm";
import { finalizeAssignedImport } from "./final-review-actions";

export function FinalReviewPanel({ submissionId, version, previewReady = false }: {
  submissionId: number; version: number; previewReady?: boolean;
}) {
  const [state, action, pending] = useActionState(finalizeAssignedImport.bind(null, submissionId, version), {} as ImportActionState);
  const complete = Boolean(state.message && !state.error);
  return <form action={action} className="mt-4 rounded-2xl bg-white p-4 shadow-sm" onSubmit={event => {
    const intent = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    if (pending || complete || (intent !== "return" && !previewReady)) event.preventDefault();
  }}>
    <h2 className="font-bold text-gray-800">成员投稿终审</h2>
    <fieldset disabled={pending || complete} className="mt-3 space-y-3">
      {!previewReady && <p role="status" className="text-sm leading-6 text-amber-700">
        请等待所有照片预览加载完成；若加载失败，请刷新页面重试。仍可退回成员修改。
      </p>}
      <label className="block text-sm text-gray-700">退回说明（选填）
        <textarea name="reviewNote" maxLength={300} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 p-2" placeholder="告诉成员需要修改的地方" />
      </label>
      <div className="flex flex-wrap gap-3">
        <button name="intent" value="return" className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-bold text-amber-800">退回修改</button>
        <button name="intent" value="approve" disabled={!previewReady} className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">审核通过并发布</button>
      </div>
      <p className="text-xs text-gray-500">退回会保留文字和照片，成员修改后可重新提交。</p>
    </fieldset>
    <div aria-live="polite">
      {pending && <p role="status" className="mt-3 text-sm text-gray-500">正在处理终审，请稍候…</p>}
      {state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="mt-3 text-sm text-emerald-700">{state.message}</p>}
    </div>
  </form>;
}

export function AssignedFinalReview({ submissionId, ...props }: Omit<DraftFormProps, "mode" | "onReview" | "onPreviewReadyChange"> & { submissionId: number }) {
  const [previewReady, setPreviewReady] = useState(false);
  return <>
    <DraftForm {...props} mode="admin" onPreviewReadyChange={setPreviewReady} />
    <FinalReviewPanel submissionId={submissionId} version={props.version} previewReady={previewReady} />
  </>;
}
