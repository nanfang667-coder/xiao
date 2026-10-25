"use client";

import { useState, useTransition } from "react";
import { setMerchantVisibility } from "./actions";

export function MerchantVisibilityButton({
  id,
  isPublished,
}: {
  id: number;
  isPublished: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function changeVisibility() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await setMerchantVisibility(id, !isPublished);
        if (result.error) setError("操作失败，请稍后重试。");
      } catch {
        setError("操作失败，请稍后重试。");
      }
    });
  }

  return (
    <div className="flex max-w-32 flex-col items-end gap-1">
      <button
        type="button"
        onClick={changeVisibility}
        disabled={pending}
        aria-busy={pending}
        aria-label={isPublished ? "隐藏商家帖子" : "恢复商家帖子展示"}
        className="rounded-lg border border-pink-200 px-3 py-1 text-xs text-pink-500 active:bg-pink-50 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? "处理中…" : isPublished ? "隐藏" : "恢复展示"}
      </button>
      {error && <p role="alert" className="text-right text-xs text-red-500">{error}</p>}
    </div>
  );
}
