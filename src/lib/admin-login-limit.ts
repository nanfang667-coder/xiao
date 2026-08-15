import "server-only";

import { createAdminLoginLimitBuckets } from "@/lib/admin-login-limit-token";
import { prisma } from "@/lib/prisma";

function rateLimitSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret)
    throw new Error(
      "JWT_SECRET is required for administrator login throttling",
    );
  return secret;
}

export async function canAttemptAdminLogin(
  clientIp: string,
  now = new Date(),
): Promise<boolean> {
  const buckets = createAdminLoginLimitBuckets(
    clientIp,
    rateLimitSecret(),
    now,
  );
  const rows = await prisma.adminLoginRateLimit.findMany({
    where: { keyHash: { in: buckets.map((bucket) => bucket.keyHash) } },
    select: { keyHash: true, attempts: true },
  });
  const attemptsByKey = new Map(rows.map((row) => [row.keyHash, row.attempts]));
  return buckets.every(
    (bucket) => (attemptsByKey.get(bucket.keyHash) ?? 0) < bucket.limit,
  );
}

export async function recordAdminLoginFailure(
  clientIp: string,
  now = new Date(),
): Promise<{ blocked: boolean; newlyBlockedScopes: Array<"ip" | "global"> }> {
  const buckets = createAdminLoginLimitBuckets(
    clientIp,
    rateLimitSecret(),
    now,
  );

  return prisma.$transaction(async (tx) => {
    await tx.adminLoginRateLimit.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    const records: Array<{ attempts: number }> = [];
    for (const bucket of buckets) {
      records.push(
        await tx.adminLoginRateLimit.upsert({
          where: { keyHash: bucket.keyHash },
          create: {
            keyHash: bucket.keyHash,
            attempts: 1,
            expiresAt: bucket.expiresAt,
          },
          update: { attempts: { increment: 1 } },
          select: { attempts: true },
        }),
      );
    }

    const newlyBlockedScopes = buckets
      .filter((bucket, index) => records[index].attempts === bucket.limit)
      .map((bucket) => bucket.scope);
    const blocked = buckets.some(
      (bucket, index) => records[index].attempts >= bucket.limit,
    );
    return { blocked, newlyBlockedScopes };
  });
}
