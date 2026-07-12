// 简单的内存滑动窗口限流器：同一个 key（比如 IP）在时间窗口内超过次数限制就拒绝。
// 用 Map 存在进程内存里，重启会清空——当前单进程部署规模够用，不需要上 Redis。

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastCleanup = 0;

// 定期清掉过期的桶，避免内存随时间无限增长
function cleanup(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// 返回 true 表示本次请求放行，false 表示已超过限制
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  if (now - lastCleanup > windowMs) {
    cleanup(now);
    lastCleanup = now;
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
