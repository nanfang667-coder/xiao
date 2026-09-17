ALTER TABLE "TeacherSubmission" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "TeacherSubmission_submissionKey_key" ON "TeacherSubmission"("submissionKey");
