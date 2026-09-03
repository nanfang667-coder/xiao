import type { Prisma } from "@prisma/client";

export const TEAM_MONTHLY_POST_LIMITS = [30, 150] as const;

export function parseTeamMonthlyPostLimit(value: unknown): 30 | 150 | null {
  const limit = Number(value);
  return TEAM_MONTHLY_POST_LIMITS.includes(limit as 30 | 150)
    ? (limit as 30 | 150)
    : null;
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
