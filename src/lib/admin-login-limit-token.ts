import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_LOGIN_IP_FAILURE_LIMIT = 5;
export const ADMIN_LOGIN_GLOBAL_FAILURE_LIMIT = 30;

export type AdminLoginLimitBucket = {
  scope: "ip" | "global";
  keyHash: string;
  limit: number;
  expiresAt: Date;
};

function bucketHash(
  secret: string,
  scope: string,
  value: string,
  windowId: number,
): string {
  return createHmac("sha256", secret)
    .update(`admin-login-v1:${scope}:${value}:${windowId}`, "utf8")
    .digest("hex");
}

export function createAdminLoginLimitBuckets(
  clientIp: string,
  secret: string,
  now = new Date(),
): AdminLoginLimitBucket[] {
  if (!secret)
    throw new Error(
      "JWT_SECRET is required for administrator login throttling",
    );

  const windowId = Math.floor(now.getTime() / ADMIN_LOGIN_WINDOW_MS);
  const expiresAt = new Date((windowId + 1) * ADMIN_LOGIN_WINDOW_MS);
  const normalizedIp = clientIp || "unknown";

  return [
    {
      scope: "ip",
      keyHash: bucketHash(secret, "ip", normalizedIp, windowId),
      limit: ADMIN_LOGIN_IP_FAILURE_LIMIT,
      expiresAt,
    },
    {
      scope: "global",
      keyHash: bucketHash(secret, "global", "administrator", windowId),
      limit: ADMIN_LOGIN_GLOBAL_FAILURE_LIMIT,
      expiresAt,
    },
  ];
}

export function isAdminPasswordValid(
  candidate: string,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
