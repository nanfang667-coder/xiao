"use server";

import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import { requireTeamQuotaHistoryReady } from "@/lib/team-quota-history-readiness";
import {
  getEffectiveTeamPostLimit,
  getTeamPostBaseLimit,
  parseNewTeamPostLimit,
  parseTeamPostLimit,
} from "@/lib/team-post-quota";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

const quotaAccountSelect = {
  id: true,
  username: true,
  monthlyPostLimit: true,
  monthlyPostLimitOverride: true,
  monthlyPostBonus: true,
} as const;

function refreshQuotaPages() {
  revalidatePath("/adminzhangzhang/sites");
  revalidatePath("/adminzhangzhang/sites/quota-history");
  revalidatePath("/team");
  revalidatePath("/team/posts");
  revalidatePath("/team/posts/new");
}

export async function createTeamAccount(formData: FormData) {
  await requireAdmin();
  const username = text(formData, "username").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const siteId = text(formData, "siteId");
  const monthlyPostLimit = parseNewTeamPostLimit(
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

  await requireTeamQuotaHistoryReady();
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async tx => {
    const account = await tx.teamAccount.create({
      select: quotaAccountSelect,
      data: {
        username,
        passwordHash,
        siteId: site.id,
        monthlyPostLimit: monthlyPostLimit === 150 ? 150 : 30,
        monthlyPostLimitOverride: monthlyPostLimit,
      },
    });
    const limit = getEffectiveTeamPostLimit(account);
    await tx.teamPostQuotaEvent.create({
      data: {
        teamAccountId: account.id, teamUsername: account.username,
        kind: "account_created", delta: limit, previousLimit: 0, newLimit: limit,
      },
    });
  });
  refreshQuotaPages();
  revalidatePath("/adminzhangzhang/submissions");
}

export async function updateTeamMonthlyPostLimit(
  accountId: number,
  formData: FormData,
) {
  await requireAdmin();
  const monthlyPostLimit = parseTeamPostLimit(
    formData.get("monthlyPostLimit"),
  );
  if (
    !Number.isSafeInteger(accountId) ||
    accountId < 1 ||
    monthlyPostLimit === null
  ) {
    throw new Error("Invalid team post limit");
  }
  await requireTeamQuotaHistoryReady();
  await prisma.$transaction(async tx => {
    const account = await tx.teamAccount.findUnique({
      where: { id: accountId }, select: quotaAccountSelect,
    });
    if (!account || (monthlyPostLimit === 30 && getTeamPostBaseLimit(account) !== 30)) {
      throw new Error("Legacy 30-post tier cannot be newly assigned");
    }
    if (monthlyPostLimit === getTeamPostBaseLimit(account)) return;
    const before = getEffectiveTeamPostLimit(account);
    const updated = await tx.teamAccount.update({
      where: { id: accountId },
      select: quotaAccountSelect,
      data: {
        monthlyPostLimit: monthlyPostLimit === 150 ? 150 : 30,
        monthlyPostLimitOverride:
          monthlyPostLimit === 30 ? null : monthlyPostLimit,
      },
    });
    const after = getEffectiveTeamPostLimit(updated);
    await tx.teamPostQuotaEvent.create({
      data: {
        teamAccountId: account.id, teamUsername: account.username,
        kind: "base_changed", delta: after - before, previousLimit: before, newLimit: after,
      },
    });
  });
  refreshQuotaPages();
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
    throw new Error("Invalid team post allowance");
  }

  await requireTeamQuotaHistoryReady();
  await prisma.$transaction(async tx => {
    // Acquire the write lock before reading the resulting balance, so the log
    // describes this exact increment even when administrators submit together.
    const updated = await tx.teamAccount.updateMany({
      where: { id: accountId, monthlyPostBonus: { gte: 0, lte: 10000 - amount } },
      data: { monthlyPostBonus: { increment: amount } },
    });
    if (updated.count !== 1) throw new Error("Team account not found or post allowance is too large");
    const account = await tx.teamAccount.findUnique({
      where: { id: accountId }, select: quotaAccountSelect,
    });
    if (!account) throw new Error("Team account not found");
    const after = getEffectiveTeamPostLimit(account);
    await tx.teamPostQuotaEvent.create({
      data: {
        teamAccountId: account.id, teamUsername: account.username,
        kind: "allowance_added", delta: amount, previousLimit: after - amount, newLimit: after,
      },
    });
  });
  refreshQuotaPages();
}

export async function resetTeamPassword(accountId: number, formData: FormData) {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (!Number.isSafeInteger(accountId) || accountId < 1 || password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
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
  revalidatePath("/adminzhangzhang/submissions");
}

export async function deleteTeamAccount(accountId: number) {
  await requireAdmin();
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    throw new Error("Invalid team account");
  }
  const assignmentReady = await isPartnerImportAssignmentReady();
  try {
    await prisma.$transaction(async (tx) => {
      const where = { teamAccountId: accountId };
      if (assignmentReady) {
        // Return unfinished assignments to the private pool before removing the account.
        await tx.partnerImportDraft.updateMany({
          where: { ...where, status: { in: ["assigned", "returned", "submitted"] } },
          data: { teamAccountId: null, status: "ready", version: { increment: 1 } },
        });
        await tx.partnerImportDraft.updateMany({
          where, data: { teamAccountId: null, version: { increment: 1 } },
        });
      }
      // Restrict foreign keys roll back this transaction if an old client cannot
      // release assignments that already exist in a migrated database.
      await tx.teamSession.deleteMany({ where });
      await tx.teacherSubmission.deleteMany({ where });
      await tx.teacherOwnership.deleteMany({ where });
      await tx.teamAccount.deleteMany({ where: { id: accountId } });
    });
  } catch (error) {
    if (!assignmentReady) throw new Error("账号删除未完成，请刷新页面后重试。");
    throw error;
  }
  revalidatePath("/adminzhangzhang/sites");
  revalidatePath("/adminzhangzhang/submissions");
  revalidatePath("/adminzhangzhang/teachers");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/partner-import");
  revalidatePath("/team", "layout");
}
