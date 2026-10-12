-- Short-link attribution is independent of existing users, referral visits and sites.
CREATE TABLE "PromotionChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PromotionChannelVisit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 1,
    "firstVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionChannelVisit_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "PromotionChannel" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromotionChannel_code_key" ON "PromotionChannel"("code");
CREATE UNIQUE INDEX "PromotionChannel_hostname_key" ON "PromotionChannel"("hostname");
CREATE UNIQUE INDEX "PromotionChannelVisit_channelId_visitorKey_key"
ON "PromotionChannelVisit"("channelId", "visitorKey");
CREATE INDEX "PromotionChannelVisit_firstVisitedAt_channelId_idx"
ON "PromotionChannelVisit"("firstVisitedAt", "channelId");
CREATE INDEX "PromotionChannelVisit_lastVisitedAt_channelId_idx"
ON "PromotionChannelVisit"("lastVisitedAt", "channelId");
