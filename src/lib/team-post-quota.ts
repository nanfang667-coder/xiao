import type { Prisma } from "@prisma/client";

export const NEW_TEAM_MONTHLY_POST_LIMITS = [22, 150] as const;
export const ALLOWED_TEAM_MONTHLY_POST_LIMITS = [22, 30, 150] as const;

export function parseTeamMonthlyPostLimit(
  value: unknown,
): 22 | 30 | 150 | null {
  const limit = Number(value);
  return ALLOWED_TEAM_MONTHLY_POST_LIMITS.includes(limit as 22 | 30 | 150)
    ? (limit as 22 | 30 | 150)
    : null;
}

export function parseNewTeamMonthlyPostLimit(value: unknown): 22 | 150 | null {
  const limit = Number(value);
  return NEW_TEAM_MONTHLY_POST_LIMITS.includes(limit as 22 | 150)
    ? (limit as 22 | 150)
    : null;
}

export function getChinaCalendarMonthKey(now: Date = new Date()): string {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(now.getTime() + chinaOffsetMs);
  return `${chinaTime.getUTCFullYear()}-${String(
    chinaTime.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

export function getEffectiveTeamMonthlyPostLimit(
  account: {
    monthlyPostLimit: number;
    monthlyPostLimitOverride: number | null;
    monthlyPostBonus: number;
    monthlyPostBonusMonth: string | null;
  },
  now: Date = new Date(),
): number {
  const baseLimit = getTeamMonthlyPostBaseLimit(account);
  const currentBonus =
    account.monthlyPostBonusMonth === getChinaCalendarMonthKey(now)
      ? Math.max(0, Math.trunc(account.monthlyPostBonus))
      : 0;
  return baseLimit + currentBonus;
}

export function getTeamMonthlyPostBaseLimit(account: {
  monthlyPostLimit: number;
  monthlyPostLimitOverride: number | null;
}): number {
  const override = parseNewTeamMonthlyPostLimit(
    account.monthlyPostLimitOverride,
  );
  if (override !== null) return override;
  return parseTeamMonthlyPostLimit(account.monthlyPostLimit) ?? 30;
}

export function getChinaCalendarMonthRange(now: Date = new Date()) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(now.getTime() + chinaOffsetMs);
  const year = chinaTime.getUTCFullYear();
  const month = chinaTime.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1) - chinaOffsetMs),
    end: new Date(Date.UTC(year, month + 1, 1) - chinaOffsetMs),
  };
}

export function getTeamMonthlyPostUsageWhere(
  teamAccountId: number,
  now: Date = new Date(),
): Prisma.TeacherSubmissionWhereInput {
  const { start, end } = getChinaCalendarMonthRange(now);
  return {
    teamAccountId,
    kind: "create",
    status: { in: ["pending", "approved"] },
    createdAt: { gte: start, lt: end },
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
