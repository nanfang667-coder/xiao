CREATE TABLE "AlleyPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "coverPhoto" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detailPhotos" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "AlleyPost_isPublished_sortOrder_createdAt_idx"
ON "AlleyPost"("isPublished", "sortOrder", "createdAt");

CREATE INDEX "AlleyPost_city_district_sortOrder_idx"
ON "AlleyPost"("city", "district", "sortOrder");
