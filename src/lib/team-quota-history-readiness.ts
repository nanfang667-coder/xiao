import "server-only";
import { prisma } from "./prisma";

export const TEAM_QUOTA_HISTORY_UNAVAILABLE = "额度记录尚未启用，请完成升级并重启服务后再试。";

// Metadata only. A failed or partial upgrade must never allow unlogged grants.
export async function isTeamQuotaHistoryReady(): Promise<boolean> {
  try {
    if (!prisma.teamPostQuotaEvent?.fields?.teamUsername) return false;
    const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(
      'PRAGMA table_info("TeamPostQuotaEvent")',
    );
    return [
      "id", "teamAccountId", "teamUsername", "kind", "delta", "previousLimit",
      "newLimit", "legacyBonus", "legacyMonth", "createdAt",
    ].every(name => columns.some(column => column.name === name));
  } catch {
    return false;
  }
}

export async function requireTeamQuotaHistoryReady(): Promise<void> {
  if (!await isTeamQuotaHistoryReady()) throw new Error(TEAM_QUOTA_HISTORY_UNAVAILABLE);
}
