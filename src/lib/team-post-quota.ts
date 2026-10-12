import type { Prisma } from "@prisma/client";

export const NEW_TEAM_POST_LIMITS = [22, 150] as const;
export const ALLOWED_TEAM_POST_LIMITS = [22, 30, 150] as const;

export function parseTeamPostLimit(
  value: unknown,
): 22 | 30 | 150 | null {
  const limit = Number(value);
  return ALLOWED_TEAM_POST_LIMITS.includes(limit as 22 | 30 | 150)
    ? (limit as 22 | 30 | 150)
    : null;
}

export function parseNewTeamPostLimit(value: unknown): 22 | 150 | null {
  const limit = Number(value);
  return NEW_TEAM_POST_LIMITS.includes(limit as 22 | 150)
    ? (limit as 22 | 150)
    : null;
}

// Keep the existing database columns so switching to a fixed quota preserves
// stored allowances without a destructive migration. The old month is ignored.
export function getEffectiveTeamPostLimit(
  account: {
    monthlyPostLimit: number;
    monthlyPostLimitOverride: number | null;
    monthlyPostBonus: number;
  },
): number {
  return getTeamPostBaseLimit(account) + Math.max(0, Math.trunc(account.monthlyPostBonus));
}

export function getTeamPostBaseLimit(account: {
  monthlyPostLimit: number;
  monthlyPostLimitOverride: number | null;
}): number {
  const override = parseNewTeamPostLimit(
    account.monthlyPostLimitOverride,
  );
  if (override !== null) return override;
  return parseTeamPostLimit(account.monthlyPostLimit) ?? 30;
}

// Historical submissions remain the usage ledger, including approved posts
// whose public Teacher row was later deleted. Rejected submissions release quota.
export function getTeamPostUsageWhere(
  teamAccountId?: number,
): Prisma.TeacherSubmissionWhereInput {
  return {
    ...(teamAccountId === undefined ? {} : { teamAccountId }),
    kind: "create",
    status: { in: ["pending", "approved"] },
  };
}

export function summarizeTeamPostQuota(limit: number, used: number) {
  const safeLimit = Math.max(0, Math.trunc(limit));
  const safeUsed = Math.max(0, Math.trunc(used));
  return {
    limit: safeLimit,
    used: safeUsed,
    remaining: Math.max(0, safeLimit - safeUsed),
    exhausted: safeUsed >= safeLimit,
  };
}
