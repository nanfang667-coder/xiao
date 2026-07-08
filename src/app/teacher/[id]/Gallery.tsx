"use client"; // 有点击交互，要在浏览器运行

import { useState } from "react";
import { isImage } from "@/lib/photo";

// 照片展示：先以网格缩略图展示所有照片，点击任意一张弹出完整大图，
// 大图用 object-contain（不裁切、完整显示），可左右切换查看其它照片。
export function Gallery({ photos, emoji }: { photos: string[]; emoji: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      {/* 缩略图网格：两列，展示全部照片 */}
      <div className="grid grid-cols-2 gap-1 bg-white">
        {photos.length === 0 && (
          <div className="col-span-2 flex h-56 items-center justify-center bg-gradient-to-br from-pink-300 to-rose-400 text-6xl">
            {emoji}
          </div>
        )}
        {photos.map((p, i) =>
          isImage(p) ? (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="aspect-square touch-manipulation select-none overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover"
              />
            </button>
          ) : (
            <div
              key={i}
              className={`flex aspect-square items-center justify-center bg-gradient-to-br text-5xl ${p}`}
            >
              {emoji}
            </div>
          )
        )}
      </div>

      {/* 大图预览层：点击缩略图后弹出。
          只把"真实图片"传给它，并用下标（而非URL字符串）做原数组↔真实图片列表的映射——
          这样左右切换（prev/next）只会在真实图片之间循环，不会切到占位色块上
          去渲染出一张 broken image；用下标映射也不怕数组里出现重复的图片URL。
          （目前后台的增删改逻辑保证照片数组不会真图/占位色块混合，这里是防御性处理。） */}
      {openIndex !== null && (() => {
        const realIndices = photos.map((_, i) => i).filter((i) => isImage(photos[i]));
        const realPhotos = realIndices.map((i) => photos[i]);
        const realIndex = realIndices.indexOf(openIndex);
        if (realIndex === -1) return null; // 理论上不会发生：openIndex只在isImage分支里被设置
        return (
          <Lightbox
            photos={realPhotos}
            index={realIndex}
            onClose={() => setOpenIndex(null)}
            onChange={(i) => setOpenIndex(realIndices[i])}
          />
        );
      })()}
    </>
  );
}

// 全屏大图查看：完整显示（不裁切）+ 左右切换 + 点击背景关闭
function Lightbox({
  photos,
  index,
  onClose,
  onChange,
}: {
  photos: string[];
  index: number;
  onClose: () => void;
  onChange: (i: number) => void;
}) {
  const prev = () => onChange((index - 1 + photos.length) % photos.length);
  const next = () => onChange((index + 1) % photos.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 touch-manipulation items-center justify-center rounded-full bg-white/10 text-xl text-white active:bg-white/20"
      >
        ✕
      </button>

      {/* 第几张 / 共几张 */}
      {photos.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {index + 1} / {photos.length}
        </div>
      )}

      {/* 完整图片：object-contain 保证不裁切、完整可见 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[index]}
        alt=""
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {/* 左右切换 */}
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-2 flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-white/10 text-2xl text-white active:bg-white/20"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-2 flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-white/10 text-2xl text-white active:bg-white/20"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
