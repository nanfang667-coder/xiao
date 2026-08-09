"use client"; // 要用浏览器历史记录，得在客户端运行

import { useRouter } from "next/navigation";

// 用"返回上一页"而不是固定跳首页，这样从筛选过的老师列表点进详情页、
// 再点返回时，能带着原来的省份/城市筛选结果回去，而不是回到"全部地区"
export function BackButton() {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <button type="button" onClick={handleBack} className="text-pink-500">
      ← 返回
    </button>
  );
}
