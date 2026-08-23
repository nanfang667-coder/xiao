-- CreateTable
CREATE TABLE "Merchant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "price" TEXT,
    "services" TEXT NOT NULL,
    "description" TEXT,
    "photos" TEXT NOT NULL,
    "phone" TEXT,
    "wechat" TEXT,
    "qq" TEXT,
    "otherContact" TEXT,
    "address" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Merchant_isPublished_sortOrder_createdAt_idx" ON "Merchant"("isPublished", "sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "Merchant_city_district_sortOrder_idx" ON "Merchant"("city", "district", "sortOrder");
