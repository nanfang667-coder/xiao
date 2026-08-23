-- CreateTable
CREATE TABLE "PartnerLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'exchange',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PartnerLink_isPublished_sortOrder_createdAt_idx" ON "PartnerLink"("isPublished", "sortOrder", "createdAt");
