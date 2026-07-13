ALTER TABLE "Teacher" ADD COLUMN "source" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "sourceId" INTEGER;
CREATE UNIQUE INDEX "Teacher_source_sourceId_key" ON "Teacher"("source", "sourceId");
