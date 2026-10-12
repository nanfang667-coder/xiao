-- Assignment workflow only: existing imported drafts stay pending and unassigned.
ALTER TABLE "PartnerImportDraft" ADD COLUMN "teamAccountId" INTEGER
  REFERENCES "TeamAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherSubmission" ADD COLUMN "partnerImportDraftId" INTEGER
  REFERENCES "PartnerImportDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PartnerImportDraft_teamAccountId_status_updatedAt_idx"
  ON "PartnerImportDraft"("teamAccountId", "status", "updatedAt");
CREATE UNIQUE INDEX "TeacherSubmission_partnerImportDraftId_key"
  ON "TeacherSubmission"("partnerImportDraftId");
