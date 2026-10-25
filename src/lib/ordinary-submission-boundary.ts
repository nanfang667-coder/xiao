import "server-only";
import { prisma } from "@/lib/prisma";
import { ORDINARY_SUBMISSION_WHERE } from "@/lib/cooperation-filters";

/** Isolate historical import references without loading their content or workflow. */
export async function getOrdinarySubmissionBoundary() {
  const columns = await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info("TeacherSubmission")`;
  const hasImportReference = columns.some(column => column.name === "partnerImportDraftId");
  return {
    hasImportReference,
    where: {
      ...ORDINARY_SUBMISSION_WHERE,
      ...(hasImportReference ? { partnerImportDraftId: null } : {}),
    },
  };
}
