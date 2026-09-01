type AlleyImagePlaceholderProps = {
  className?: string;
};

export function AlleyImagePlaceholder({
  className = "",
}: AlleyImagePlaceholderProps) {
  return (
    <div
      role="img"
      aria-label="暂无图片文字描述"
      className={`flex items-center justify-center bg-gray-100 text-sm text-gray-400 ${className}`}
    >
      暂无图片文字描述
    </div>
  );
}
