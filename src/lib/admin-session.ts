import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  hashAdminSessionToken,
  isAdminSessionToken,
} from "@/lib/admin-session-token";

export async function createAdminSession(): Promise<{ token: string; expiresAt: Date }> {
  const token = createAdminSessionToken();
  const tokenHash = hashAdminSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000);

  await prisma.$transaction([
    prisma.adminSession.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.adminSession.create({ data: { tokenHash, expiresAt } }),
  ]);

  return { token, expiresAt };
}

export async function validateAdminSession(token: string | undefined): Promise<boolean> {
  if (!token || !isAdminSessionToken(token)) return false;

  const tokenHash = hashAdminSessionToken(token);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    select: { expiresAt: true },
  });

  if (!session) return false;
  if (session.expiresAt <= new Date()) {
    await prisma.adminSession.deleteMany({ where: { tokenHash } });
    return false;
  }

  return true;
}

export async function revokeAdminSession(token: string | undefined): Promise<void> {
  if (!token || !isAdminSessionToken(token)) return;
  await prisma.adminSession.deleteMany({
    where: { tokenHash: hashAdminSessionToken(token) },
  });
}