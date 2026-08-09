"use client"; // 要用浏览器历史记录，得在客户端运行

import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// 有可靠的站内来源页时返回原筛选结果；否则链接始终可以回到首页。
export function BackButton() {
  const router = useRouter();

  const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
    try {
      const referrer = new URL(document.referrer);
      const currentPath = window.location.pathname;
      const canReturnToReferrer =
        referrer.origin === window.location.origin &&
        referrer.pathname !== currentPath &&
        !referrer.pathname.startsWith("/teacher/");

      if (canReturnToReferrer) {
        event.preventDefault();
        router.back();
      }
    } catch {
      // 没有可用的站内来源页时，保留下面链接的首页兜底。
    }
  };

  return (
    <Link href="/" onClick={handleBack} className="text-pink-500">
      ← 返回
    </Link>
  );
}
