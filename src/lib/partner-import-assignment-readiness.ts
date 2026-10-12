import "server-only";
import { prisma } from "./prisma";

export const PARTNER_ASSIGNMENT_UNAVAILABLE = "分配流程尚未启用，请完成数据库升级并重启服务后再试。";

export class PartnerImportAssignmentUnavailableError extends Error {
  constructor() {
    super(PARTNER_ASSIGNMENT_UNAVAILABLE);
    this.name = "PartnerImportAssignmentUnavailableError";
  }
}

/**
 * Check the live client's public field references before using new selections.
 * These fixed metadata-only PRAGMAs never inspect imported or account records.
 * Do not cache a negative result: a later upgrade can make the feature ready.
 */
export async function isPartnerImportAssignmentReady(): Promise<boolean> {
  try {
    if (!prisma.partnerImportDraft.fields?.teamAccountId ||
        !prisma.teacherSubmission.fields?.partnerImportDraftId) return false;
    const draftColumns = await prisma.$queryRawUnsafe<{ name: string }[]>('PRAGMA table_info("PartnerImportDraft")');
    if (!draftColumns.some(column => column.name === "teamAccountId")) return false;
    const submissionColumns = await prisma.$queryRawUnsafe<{ name: string }[]>('PRAGMA table_info("TeacherSubmission")');
    return submissionColumns.some(column => column.name === "partnerImportDraftId");
  } catch {
    // Neither database diagnostics nor deployment paths should reach the UI.
    return false;
  }
}

export async function requirePartnerImportAssignmentReady(): Promise<void> {
  if (!await isPartnerImportAssignmentReady()) throw new PartnerImportAssignmentUnavailableError();
}
