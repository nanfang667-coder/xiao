"use client"; // 需要访问浏览器剪贴板

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 非 HTTPS/不支持剪贴板API 的环境会失败，链接文本本身可见，用户可手动长按复制
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="mt-3 w-full rounded-full bg-white/20 py-2 text-sm font-bold text-white active:bg-white/30"
    >
      {copied ? "已复制 ✓" : "复制链接"}
    </button>
  );
}
