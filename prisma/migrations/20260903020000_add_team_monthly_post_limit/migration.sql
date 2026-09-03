-- Existing collaborator accounts start on the 30-post monthly tier.
ALTER TABLE "TeamAccount"
ADD COLUMN "monthlyPostLimit" INTEGER NOT NULL DEFAULT 30
CHECK ("monthlyPostLimit" IN (30, 150));

-- Supports monthly usage checks without scanning an account's full submission history.
CREATE INDEX "TeacherSubmission_teamAccountId_kind_status_createdAt_idx"
ON "TeacherSubmission"("teamAccountId", "kind", "status", "createdAt");
