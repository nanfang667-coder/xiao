import "server-only";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePartnerPhotoKeys } from "@/lib/partner-import-photos";
import { isPartnerImportAssignmentReady } from "@/lib/partner-import-assignment-readiness";
import {
  ACCOUNT_PAGE_SIZE,
  cooperationPagination,
  cooperationPublishedWhere,
  cooperationSubmissionWhere,
  type CooperationFilters,
} from "@/lib/cooperation-filters";

export async function getCooperationManagement(filters: CooperationFilters) {
  await requireAdmin();
  const assignmentReady = await isPartnerImportAssignmentReady();
  const scope = filters.accountId === null ? {} : { teamAccountId: filters.accountId };
  const [accounts, selectedAccount, pending, published, history] = await Promise.all([
    prisma.teamAccount.findMany({
      where: filters.accountQuery ? { username: { contains: filters.accountQuery } } : {},
      select: {
        id: true, username: true, isActive: true,
        _count: { select: { teacherOwnerships: true, submissions: { where: { status: "pending" } } } },
        submissions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
      },
    }),
    filters.accountId === null ? null : prisma.teamAccount.findUnique({
      where: { id: filters.accountId }, select: { id: true, username: true },
    }),
    prisma.teacherSubmission.count({ where: { ...scope, status: "pending" } }),
    prisma.teacherOwnership.count({ where: scope }),
    prisma.teacherSubmission.count({ where: { ...scope, status: { in: ["approved", "rejected"] } } }),
  ]);
  // Only small account summaries are loaded; post bodies are always database-paginated.
  accounts.sort((a, b) =>
    b._count.submissions - a._count.submissions ||
    (b.submissions[0]?.createdAt.getTime() ?? 0) - (a.submissions[0]?.createdAt.getTime() ?? 0) ||
    a.username.localeCompare(b.username) || a.id - b.id,
  );
  const accountPagination = cooperationPagination(accounts.length, filters.accountPage, ACCOUNT_PAGE_SIZE);
  const shared = {
    accounts: accounts.slice(accountPagination.skip, accountPagination.skip + accountPagination.take),
    accountPagination, selectedAccount, assignmentReady, counts: { pending, published, history },
  };
  if (filters.view === "published") {
    const where = cooperationPublishedWhere(filters);
    const total = await prisma.teacherOwnership.count({ where });
    const pagination = cooperationPagination(total, filters.page);
    const ownerships = await prisma.teacherOwnership.findMany({
      where, skip: pagination.skip, take: pagination.take,
      orderBy: [{ teacher: { createdAt: "desc" } }, { teacherId: "desc" }],
      select: {
        teamAccountId: true,
        account: { select: { username: true } },
        teacher: { select: {
          id: true, name: true, city: true, district: true, price: true, emoji: true,
          photos: true, createdAt: true, viewCount: true,
        } },
      },
    });
    return { ...shared, pagination, ownerships, submissions: [] };
  }
  const where = cooperationSubmissionWhere(filters);
  const total = await prisma.teacherSubmission.count({ where });
  const pagination = cooperationPagination(total, filters.page);
  const submissions = await prisma.teacherSubmission.findMany({
    where, skip: pagination.skip, take: pagination.take,
    orderBy: filters.view === "pending"
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : [{ reviewedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, teamAccountId: true, teacherId: true, kind: true, status: true, submissionKey: true,
      ...(assignmentReady ? { partnerImportDraftId: true } : {}),
      ...(assignmentReady && filters.view === "pending" ? {
        partnerImportDraft: { select: { id: true, version: true, status: true, teamAccountId: true, photos: true } },
      } : {}),
      name: true, city: true, district: true, price: true, age: true, emoji: true, photos: true,
      services: true, courseNotes: true, phone: true, wechat: true, qq: true,
      otherContact: true, address: true, createdAt: true, reviewedAt: true, reviewNote: true,
      account: { select: { username: true } },
    },
  });
  return {
    ...shared, pagination, ownerships: [],
    submissions: submissions.map(({ submissionKey, partnerImportDraft, ...submission }) => {
      let importReview: { draftId: number; version: number; photos: string[] | null } | null = null;
      if (assignmentReady && submission.status === "pending" && submission.kind === "create" && partnerImportDraft?.status === "submitted"
          && partnerImportDraft.id === submission.partnerImportDraftId && partnerImportDraft.teamAccountId === submission.teamAccountId) {
        let photos: string[] | null;
        try { photos = parsePartnerPhotoKeys(partnerImportDraft.photos); }
        catch { photos = null; }
        importReview = { draftId: partnerImportDraft.id, version: partnerImportDraft.version, photos };
      }
      return {
        ...submission, importReview,
        partnerImportDraftId: submission.partnerImportDraftId ?? null,
        // The existing key keeps imported submissions distinct even with an old client.
        isPartnerImport: Boolean(submission.partnerImportDraftId || submissionKey?.startsWith("partner-import:")),
      };
    }),
  };
}
