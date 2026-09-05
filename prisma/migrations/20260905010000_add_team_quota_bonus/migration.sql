-- Preserve every existing account's 30/150 base limit while changing the
-- default for future accounts to 22 and adding a current-month bonus.
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

CREATE TABLE "new_TeamAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "monthlyPostLimit" INTEGER NOT NULL DEFAULT 22
        CHECK ("monthlyPostLimit" IN (22, 30, 150)),
    "monthlyPostBonus" INTEGER NOT NULL DEFAULT 0
        CHECK ("monthlyPostBonus" >= 0),
    "monthlyPostBonusMonth" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamAccount_siteId_fkey"
        FOREIGN KEY ("siteId") REFERENCES "Site" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_TeamAccount" (
    "id",
    "username",
    "passwordHash",
    "siteId",
    "monthlyPostLimit",
    "monthlyPostBonus",
    "monthlyPostBonusMonth",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "username",
    "passwordHash",
    "siteId",
    "monthlyPostLimit",
    0,
    NULL,
    "isActive",
    "createdAt",
    "updatedAt"
FROM "TeamAccount";

DROP TABLE "TeamAccount";
ALTER TABLE "new_TeamAccount" RENAME TO "TeamAccount";

CREATE UNIQUE INDEX "TeamAccount_username_key"
ON "TeamAccount"("username");

CREATE INDEX "TeamAccount_siteId_isActive_idx"
ON "TeamAccount"("siteId", "isActive");

PRAGMA defer_foreign_keys=OFF;
PRAGMA foreign_keys=ON;
