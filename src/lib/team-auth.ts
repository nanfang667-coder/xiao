import "server-only";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentSite } from "@/lib/site";

export const TEAM_SESSION_COOKIE_NAME = "team_session";
const TEAM_SESSION_COOKIE_PATH = "/team";
const TEAM_SESSION_TTL_SECONDS = 12 * 60 * 60;
const TEAM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_PASSWORD_HASH =
  "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function loginTeamAccount(
  username: string,
  password: string,
): Promise<boolean> {
  const [account, currentSite] = await Promise.all([
    prisma.teamAccount.findUnique({
      where: { username },
      include: { site: true },
    }),
    getCurrentSite(),
  ]);
  const passwordValid = await bcrypt.compare(
    password,
    account?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (
    !account ||
    account.siteId !== currentSite.id ||
    !account.isActive ||
    !account.site.isActive ||
    !passwordValid
  ) {
    return false;
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TEAM_SESSION_TTL_SECONDS * 1000);
  await prisma.$transaction([
    prisma.teamSession.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.teamSession.create({
      data: {
        tokenHash: hashToken(token),
        teamAccountId: account.id,
        expiresAt,
      },
    }),
  ]);

  const store = await cookies();
  store.set(TEAM_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: TEAM_SESSION_COOKIE_PATH,
    maxAge: TEAM_SESSION_TTL_SECONDS,
    expires: expiresAt,
    priority: "high",
  });
  return true;
}

export async function getTeamAccount() {
  const token = (await cookies()).get(TEAM_SESSION_COOKIE_NAME)?.value;
  if (!token || !TEAM_TOKEN_PATTERN.test(token)) return null;

  const [session, currentSite] = await Promise.all([
    prisma.teamSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        account: {
          include: { site: true },
        },
      },
    }),
    getCurrentSite(),
  ]);
  if (
    !session ||
    session.expiresAt <= new Date() ||
    session.account.siteId !== currentSite.id ||
    !session.account.isActive ||
    !session.account.site.isActive
  ) {
    if (session) {
      await prisma.teamSession.deleteMany({
        where: { tokenHash: session.tokenHash },
      });
    }
    return null;
  }
  return session.account;
}

export async function requireTeamAccount() {
  const account = await getTeamAccount();
  if (!account) redirect("/team/login");
  return account;
}

export async function logoutTeamAccount(): Promise<void> {
  const store = await cookies();
  const token = store.get(TEAM_SESSION_COOKIE_NAME)?.value;
  if (token && TEAM_TOKEN_PATTERN.test(token)) {
    await prisma.teamSession.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
  store.set(TEAM_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: TEAM_SESSION_COOKIE_PATH,
    maxAge: 0,
    priority: "high",
  });
}
