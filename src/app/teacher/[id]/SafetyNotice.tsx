"use client"; // 弹窗需要交互（点击关闭），要在浏览器运行

import { useState } from "react";

// 老师详情页打开时的安全提示弹窗
export function SafetyNotice() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      onClick={() => setVisible(false)}
    >
      <div
        className="max-w-xs rounded-2xl bg-white p-5 text-sm leading-relaxed text-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p>
          <span className="font-bold text-red-600">不要裸聊、刷单、下载陌生软件，</span>
          凡是要求提前转账、押金的可能是骗子，保护好个人财产。
          <span className="font-bold text-red-600">
            QQ微信风控严重，建议下载与你APP沟通，手机应用商店或官网yuni.com.cn下载。
          </span>
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="mt-4 w-full rounded-lg bg-pink-500 py-2 text-sm font-bold text-white active:bg-pink-600"
        >
          我已阅读
        </button>
      </div>
    </div>
  );
}
