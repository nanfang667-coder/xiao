import "server-only";

import { prisma } from "@/lib/prisma";
import { getChinaCalendarDayRange } from "@/lib/china-calendar";

// 两处后台共用：北京时间当天首次访问的全站独立访客，老访客回访不算新增。
export async function getTodayNewVisitorCount(now: Date = new Date()): Promise<number> {
  const { start, end } = getChinaCalendarDayRange(now);
  return prisma.siteVisit.count({
    where: { firstVisitedAt: { gte: start, lt: end } },
  });
}

// 近24小时访问过的全站独立访客；同一访客多次访问仍只计一人。
export async function getLast24HourVisitorCount(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return prisma.siteVisit.count({
    where: { lastVisitedAt: { gte: since } },
  });
}
