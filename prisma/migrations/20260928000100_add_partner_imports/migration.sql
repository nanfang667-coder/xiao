CREATE TABLE "PartnerImportSource" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "origin" TEXT NOT NULL,
  "rules" TEXT NOT NULL, "imageOrigins" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PartnerImportSource_origin_key" ON "PartnerImportSource"("origin");
CREATE TABLE "PartnerImportJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "sourceId" INTEGER NOT NULL, "listUrl" TEXT NOT NULL,
  "rules" TEXT NOT NULL, "imageOrigins" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerImportJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PartnerImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PartnerImportJob_createdAt_idx" ON "PartnerImportJob"("createdAt");
CREATE TABLE "PartnerImportItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "jobId" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued', "errorCode" TEXT, "draftId" INTEGER, "lockedAt" DATETIME, "lockToken" TEXT,
  CONSTRAINT "PartnerImportItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PartnerImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartnerImportItem_jobId_sourceUrl_key" ON "PartnerImportItem"("jobId", "sourceUrl");
CREATE INDEX "PartnerImportItem_jobId_status_idx" ON "PartnerImportItem"("jobId", "status");
CREATE TABLE "PartnerImportedPost" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "sourceId" INTEGER NOT NULL, "sourceUrl" TEXT NOT NULL,
  "teacherId" INTEGER, "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PartnerImportedPost_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PartnerImportSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartnerImportedPost_sourceId_sourceUrl_key" ON "PartnerImportedPost"("sourceId", "sourceUrl");
CREATE TABLE "PartnerImportDraft" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "postId" INTEGER NOT NULL, "contentHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "fields" TEXT NOT NULL, "photos" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "baseRevision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "reviewedAt" DATETIME,
  CONSTRAINT "PartnerImportDraft_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PartnerImportedPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartnerImportDraft_postId_contentHash_key" ON "PartnerImportDraft"("postId", "contentHash");
CREATE INDEX "PartnerImportDraft_status_createdAt_idx" ON "PartnerImportDraft"("status", "createdAt");
