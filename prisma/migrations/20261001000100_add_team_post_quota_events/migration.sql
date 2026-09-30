-- Quota changes are recorded from this migration onward. These audit records
-- survive account deletion, while the username remains a point-in-time snapshot.
CREATE TABLE "TeamPostQuotaEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamAccountId" INTEGER,
    "teamUsername" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER,
    "previousLimit" INTEGER,
    "newLimit" INTEGER NOT NULL,
    "legacyBonus" INTEGER,
    "legacyMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamPostQuotaEvent_teamAccountId_fkey" FOREIGN KEY ("teamAccountId") REFERENCES "TeamAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TeamPostQuotaEvent_createdAt_id_idx" ON "TeamPostQuotaEvent"("createdAt", "id");
CREATE INDEX "TeamPostQuotaEvent_teamAccountId_createdAt_idx" ON "TeamPostQuotaEvent"("teamAccountId", "createdAt");
CREATE INDEX "TeamPostQuotaEvent_teamUsername_createdAt_idx" ON "TeamPostQuotaEvent"("teamUsername", "createdAt");
CREATE INDEX "TeamPostQuotaEvent_legacyMonth_idx" ON "TeamPostQuotaEvent"("legacyMonth");

-- Exactly one baseline per existing account. This records the currently stored
-- allowance and its old month label, not when or how many times it was granted.
-- Do not backdate createdAt or present legacyBonus as a per-operation delta.
-- Prisma stores SQLite dates as epoch milliseconds; use the same storage class
-- so later action events sort after these snapshots correctly.
INSERT INTO "TeamPostQuotaEvent" (
    "teamAccountId", "teamUsername", "kind", "delta", "previousLimit", "newLimit", "legacyBonus", "legacyMonth", "createdAt"
)
SELECT "id", "username", 'legacy_snapshot', NULL, NULL,
    (CASE
        WHEN "monthlyPostLimitOverride" IN (22, 150) THEN "monthlyPostLimitOverride"
        WHEN "monthlyPostLimit" IN (22, 30, 150) THEN "monthlyPostLimit"
        ELSE 30
    END) + MAX(0, CAST("monthlyPostBonus" AS INTEGER)),
    "monthlyPostBonus", "monthlyPostBonusMonth",
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "TeamAccount";
