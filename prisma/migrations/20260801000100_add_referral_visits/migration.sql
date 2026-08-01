-- Track anonymous unique visitors for each user's referral link.
CREATE TABLE "ReferralVisit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "referrerId" INTEGER NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 1,
    "firstVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralVisit_referrerId_fkey"
        FOREIGN KEY ("referrerId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReferralVisit_referrerId_visitorKey_key"
ON "ReferralVisit"("referrerId", "visitorKey");

CREATE INDEX "ReferralVisit_referrerId_lastVisitedAt_idx"
ON "ReferralVisit"("referrerId", "lastVisitedAt");