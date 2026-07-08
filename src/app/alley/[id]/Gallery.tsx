"use client"; // 有滑动交互，要在浏览器运行

import { useState } from "react";
import { isImage } from "@/lib/photo";

// 照片滑动浏览组件（小巷子版）：非会员时图片整体模糊 + 锁提示
export function AlleyGallery({
  photos,
  blurred,
}: {
  photos: string[];
  blurred: boolean;
}) {
  const [active, setActive] = useState(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActive(index);
  };

  return (
    <div className="relative overflow-hidden">
      {/* 横向滑动的照片区 */}
      <div
        onScroll={handleScroll}
        className="flex h-56 snap-x snap-mandatory overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((p, i) =>
          isImage(p) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={p}
              alt=""
              className={`h-56 w-full flex-none snap-center object-cover ${
                blurred ? "scale-110 blur-xl" : ""
              }`}
            />
          ) : (
            <div
              key={i}
              className={`flex h-56 w-full flex-none snap-center items-center justify-center bg-gradient-to-br from-pink-300 to-rose-400 text-7xl ${
                blurred ? "blur-md" : ""
              }`}
            >
              🏠
            </div>
          )
        )}
      </div>

      {/* 非会员：图片上盖一层锁提示 */}
      {blurred && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20">
          <span className="text-4xl drop-shadow">🔒</span>
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white">
            开通会员查看清晰图片
          </span>
        </div>
      )}

      {/* 右上角：第几张 / 共几张 */}
      {photos.length > 1 && (
        <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-xs text-white">
          {active + 1} / {photos.length}
        </div>
      )}

      {/* 底部小圆点 */}
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {photos.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-4 bg-white" : "w-1.5 bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
