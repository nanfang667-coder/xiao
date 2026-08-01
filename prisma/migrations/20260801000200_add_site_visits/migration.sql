-- Track anonymous unique visitors across all public pages.
CREATE TABLE "SiteVisit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "visitorKey" TEXT NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 1,
    "firstVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SiteVisit_visitorKey_key"
ON "SiteVisit"("visitorKey");

CREATE INDEX "SiteVisit_lastVisitedAt_idx"
ON "SiteVisit"("lastVisitedAt");