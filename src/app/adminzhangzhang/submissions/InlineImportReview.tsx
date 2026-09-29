"use client";

import { useState } from "react";
import { FinalReviewPanel } from "../partner-import/FinalReviewPanel";

export function InlineImportReview({ submissionId, draftId, version, photos }: {
  submissionId: number; draftId: number; version: number; photos: string[] | null;
}) {
  const [loaded, setLoaded] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const ready = photos !== null && failed.length === 0 && photos.every(photo => loaded.includes(photo));

  return <section className="mt-3" aria-label={"投稿 " + submissionId + " 终审"}>
    {photos === null && <p role="alert" className="text-sm text-red-700">照片记录无法读取，请退回成员修改后重新提交。</p>}
    {photos && photos.length > 0 && <>
      <p className="mb-2 text-xs text-gray-500">发布照片预览</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {photos.map((photo, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photo} src={"/adminzhangzhang/partner-import/photos/" + draftId + "/" + encodeURIComponent(photo) + "?v=" + version}
            alt={"投稿照片 " + (index + 1)} referrerPolicy="no-referrer" loading="lazy" className="w-full rounded-lg object-contain"
            onLoad={() => {
              setLoaded(current => current.includes(photo) ? current : [...current, photo]);
              setFailed(current => current.filter(value => value !== photo));
            }}
            onError={() => {
              setLoaded(current => current.filter(value => value !== photo));
              setFailed(current => current.includes(photo) ? current : [...current, photo]);
            }} />
        ))}
      </div>
    </>}
    <p className="mt-3 text-xs leading-5 text-gray-500">提交终审时已计入 1 条发帖额度，审核发布不会再次扣除；退回修改会释放该条额度。</p>
    <FinalReviewPanel submissionId={submissionId} version={version} previewReady={ready} />
  </section>;
}
