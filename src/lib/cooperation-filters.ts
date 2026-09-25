import type { Prisma } from "@prisma/client";

export const COOPERATION_PATH = "/adminzhangzhang/submissions";
export const COOPERATION_PAGE_SIZE = 20;
export const ACCOUNT_PAGE_SIZE = 8;
export type CooperationFilters = {
  accountId: number | null;
  accountQuery: string;
  accountPage: number;
  view: "pending" | "published" | "history";
  historyStatus: "" | "approved" | "rejected";
  query: string;
  region: string;
  page: number;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] ?? "" : value ?? "").trim();
}

function positivePage(value: string): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function parseCooperationFilters(
  params: Record<string, string | string[] | undefined>,
): CooperationFilters {
  const account = first(params.account);
  const accountId = Number(account);
  const view = first(params.view);
  const status = first(params.status);
  return {
    // Invalid account parameters must never fall back to all accounts.
    accountId: !account ? null : /^\d+$/.test(account) && Number.isSafeInteger(accountId) && accountId > 0 ? accountId : -1,
    accountQuery: first(params.accountQ).slice(0, 32),
    accountPage: positivePage(first(params.accountPage)),
    view: view === "published" || view === "history" ? view : "pending",
    historyStatus: status === "approved" || status === "rejected" ? status : "",
    query: first(params.q).slice(0, 100),
    region: first(params.region).slice(0, 100),
    page: positivePage(first(params.page)),
  };
}

export function cooperationHref(
  filters: CooperationFilters,
  overrides: Partial<CooperationFilters> = {},
): string {
  const value = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (value.accountId !== null) params.set("account", String(value.accountId));
  if (value.accountQuery) params.set("accountQ", value.accountQuery);
  if (value.accountPage > 1) params.set("accountPage", String(value.accountPage));
  if (value.view !== "pending") params.set("view", value.view);
  if (value.view === "history" && value.historyStatus) params.set("status", value.historyStatus);
  if (value.query) params.set("q", value.query);
  if (value.region) params.set("region", value.region);
  if (value.page > 1) params.set("page", String(value.page));
  return `${COOPERATION_PATH}${params.size ? `?${params}` : ""}`;
}

export function cooperationSubmissionWhere(filters: CooperationFilters): Prisma.TeacherSubmissionWhereInput {
  const numericId = Number(filters.query.replace(/^#/, ""));
  return {
    ...(filters.accountId !== null ? { teamAccountId: filters.accountId } : {}),
    status: filters.view === "history"
      ? filters.historyStatus || { in: ["approved", "rejected"] }
      : "pending",
    AND: [
      ...(filters.query ? [{ OR: [
        { name: { contains: filters.query } },
        ...(Number.isSafeInteger(numericId) && numericId > 0 ? [{ id: numericId }, { teacherId: numericId }] : []),
      ] }] : []),
      ...(filters.region ? [{ OR: [{ city: { contains: filters.region } }, { district: { contains: filters.region } }] }] : []),
    ],
  };
}

export function cooperationPublishedWhere(filters: CooperationFilters): Prisma.TeacherOwnershipWhereInput {
  const numericId = Number(filters.query.replace(/^#/, ""));
  return {
    ...(filters.accountId !== null ? { teamAccountId: filters.accountId } : {}),
    teacher: { AND: [
      ...(filters.query ? [{ OR: [
        { name: { contains: filters.query } },
        ...(Number.isSafeInteger(numericId) && numericId > 0 ? [{ id: numericId }] : []),
      ] }] : []),
      ...(filters.region ? [{ OR: [{ city: { contains: filters.region } }, { district: { contains: filters.region } }] }] : []),
    ] },
  };
}

export function cooperationPagination(total: number, requestedPage: number, pageSize = COOPERATION_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { total, totalPages, page, skip: (page - 1) * pageSize, take: pageSize };
}
