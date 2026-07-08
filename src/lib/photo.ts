// 照片相关的小助手函数

// 判断一个 photo 是"上传的真实图片"（以 / 或 http 开头的网址）
// 还是"占位色块"（像 "from-indigo-400 to-purple-500" 这样的渐变类名）
export function isImage(p: string): boolean {
  return p.startsWith("/") || p.startsWith("http");
}

// 按类型给一个默认小图标
export function emojiFor(type: string): string {
  return type === "舞蹈" ? "💃" : "🎹";
}

// 没有上传照片时，用一组默认占位色块（保证卡片/详情页有东西显示）
const gradientThemes: Record<string, string[]> = {
  钢琴: [
    "from-indigo-400 to-purple-500",
    "from-purple-400 to-pink-500",
    "from-blue-400 to-indigo-500",
  ],
  舞蹈: [
    "from-rose-400 to-pink-500",
    "from-pink-400 to-fuchsia-500",
    "from-red-400 to-rose-500",
  ],
};

export function defaultGradients(type: string): string[] {
  return gradientThemes[type] ?? gradientThemes["钢琴"];
}
