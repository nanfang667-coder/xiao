"use server";

import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidMoney, normalizeHostname } from "@/lib/site-utils";
import {
  getChinaCalendarMonthKey,
  parseNewTeamMonthlyPostLimit,
  parseTeamMonthlyPostLimit,
} from "@/lib/team-post-quota";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function price(formData: FormData, key: string): number {
  const value = Number(text(formData, key));
  if (!isValidMoney(value)) throw new Error("Invalid site price");
  return Math.round(value * 100) / 100;
}

function siteInput(formData: FormData) {
  const hostname = normalizeHostname(text(formData, "hostname"));
  const name = text(formData, "name");
  const singlePostPrice = price(formData, "singlePostPrice");
  const membershipPrice = price(formData, "membershipPrice");
  const membershipOriginalPrice = price(formData, "membershipOriginalPrice");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    name.length < 1 ||
    name.length > 50 ||
    membershipOriginalPrice < membershipPrice
  ) {
    throw new Error("Invalid site configuration");
  }
  return {
    hostname,
    name,
    singlePostPrice,
    membershipPrice,
    membershipOriginalPrice,
  };
}

export async function createSite(formData: FormData) {
  await requireAdmin();
  await prisma.site.create({
    data: {
      id: randomUUID(),
      ...siteInput(formData),
    },
  });
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/sites");
  redirect("/adminzhangzhang/sites");
}

export async function updateSite(siteId: string, formData: FormData) {
  await requireAdmin();
  await prisma.site.update({
    where: { id: siteId },
    data: siteInput(formData),
  });
  revalidatePath("/", "layout");
  revalidatePath("/adminzhangzhang/sites");
}

export async function createTeamAccount(formData: FormData) {
  await requireAdmin();
  const username = text(formData, "username").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const siteId = text(formData, "siteId");
  const monthlyPostLimit = parseNewTeamMonthlyPostLimit(
    formData.get("monthlyPostLimit"),
  );
  if (
    !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username) ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 128 ||
    monthlyPostLimit === null
  ) {
    throw new Error("Invalid team account");
  }
  const site = await prisma.site.findFirst({
    where: { id: siteId, isActive: true },
    select: { id: true },
  });
  if (!site) throw new Error("Invalid team site");

  await prisma.teamAccount.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 12),
      siteId: site.id,
      monthlyPostLimit,
    },
  });
  revalidatePath("/adminzhangzhang/sites");
}

export async function updateTeamMonthlyPostLimit(
  accountId: number,
  formData: FormData,
) {
  await requireAdmin();
  const monthlyPostLimit = parseTeamMonthlyPostLimit(
    formData.get("monthlyPostLimit"),
  );
  if (
    !Number.isSafeInteger(accountId) ||
    accountId < 1 ||
    monthlyPostLimit === null
  ) {
    throw new Error("Invalid team monthly post limit");
  }
  const account = await prisma.teamAccount.findUnique({
    where: { id: accountId },
    select: { monthlyPostLimit: true },
  });
  if (!account || (monthlyPostLimit === 30 && account.monthlyPostLimit !== 30)) {
    throw new Error("Legacy 30-post tier cannot be newly assigned");
  }
  if (monthlyPostLimit !== account.monthlyPostLimit) {
    await prisma.teamAccount.update({
      where: { id: accountId },
      data: { monthlyPostLimit },
    });
  }
  revalidatePath("/adminzhangzhang/sites");
  revalidatePath("/team");
  revalidatePath("/team/posts");
  revalidatePath("/team/posts/new");
}

export async function addTeamMonthlyPostAllowance(
  accountId: number,
  formData: FormData,
) {
  await requireAdmin();
  const amount = Number(text(formData, "amount"));
  if (
    !Number.isSafeInteger(accountId) ||
    accountId < 1 ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 1000
  ) {
    throw new Error("Invalid team monthly post allowance");
  }

  const monthKey = getChinaCalendarMonthKey();
  await prisma.$transaction(async (tx) => {
    const account = await tx.teamAccount.findUnique({
      where: { id: accountId },
      select: {
        monthlyPostBonus: true,
        monthlyPostBonusMonth: true,
      },
    });
    if (!account) throw new Error("Team account not found");

    const existingBonus =
      account.monthlyPostBonusMonth === monthKey
        ? account.monthlyPostBonus
        : 0;
    if (existingBonus + amount > 10000) {
      throw new Error("Team monthly post allowance is too large");
    }
    await tx.teamAccount.update({
      where: { id: accountId },
      data: {
        monthlyPostBonus: existingBonus + amount,
        monthlyPostBonusMonth: monthKey,
      },
    });
  });

  revalidatePath("/adminzhangzhang/sites");
  revalidatePath("/team");
  revalidatePath("/team/posts");
  revalidatePath("/team/posts/new");
}

export async function resetTeamPassword(accountId: number, formData: FormData) {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
    throw new Error("Invalid team password");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.teamAccount.update({
      where: { id: accountId },
      data: { passwordHash, isActive: true },
    }),
    prisma.teamSession.deleteMany({ where: { teamAccountId: accountId } }),
  ]);
  revalidatePath("/adminzhangzhang/sites");
}

export async function disableTeamAccount(accountId: number) {
  await requireAdmin();
  await prisma.$transaction([
    prisma.teamAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    }),
    prisma.teamSession.deleteMany({ where: { teamAccountId: accountId } }),
  ]);
  revalidatePath("/adminzhangzhang/sites");
}
