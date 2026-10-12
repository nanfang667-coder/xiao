import "server-only";

import { prisma } from "@/lib/prisma";
import { getChinaCalendarDayRange } from "@/lib/china-calendar";

export type PromotionChannelSummary = {
  id: string;
  code: string;
  name: string;
  hostname: string;
  isActive: boolean;
  todayNewVisitors: number;
  last24HourVisitors: number;
  totalVisitors: number;
  visitCount: number;
};

export async function getPromotionChannelStats(now: Date = new Date()): Promise<PromotionChannelSummary[]> {
  const { start, end } = getChinaCalendarDayRange(now);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // 固定四次查询，不为每个渠道单独查询，也不把访客明细送到浏览器。
  const [channels, totals, today, recent] = await Promise.all([
    prisma.promotionChannel.findMany({
      select: { id: true, code: true, name: true, hostname: true, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.promotionChannelVisit.groupBy({
      by: ["channelId"], _count: { _all: true }, _sum: { visitCount: true },
    }),
    prisma.promotionChannelVisit.groupBy({
      by: ["channelId"], _count: { _all: true },
      where: { firstVisitedAt: { gte: start, lt: end } },
    }),
    prisma.promotionChannelVisit.groupBy({
      by: ["channelId"], _count: { _all: true },
      where: { lastVisitedAt: { gte: since } },
    }),
  ]);
  const totalsById = new Map(totals.map((row) => [row.channelId, row]));
  const todayById = new Map(today.map((row) => [row.channelId, row._count._all]));
  const recentById = new Map(recent.map((row) => [row.channelId, row._count._all]));
  return channels.map((channel) => ({
    ...channel,
    todayNewVisitors: todayById.get(channel.id) ?? 0,
    last24HourVisitors: recentById.get(channel.id) ?? 0,
    totalVisitors: totalsById.get(channel.id)?._count._all ?? 0,
    visitCount: totalsById.get(channel.id)?._sum.visitCount ?? 0,
  })).sort((a, b) => b.totalVisitors - a.totalVisitors || a.code.localeCompare(b.code));
}
