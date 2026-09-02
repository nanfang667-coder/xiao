-- Existing production records belong to the original A site.
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singlePostPrice" REAL NOT NULL DEFAULT 10,
    "membershipPrice" REAL NOT NULL DEFAULT 38,
    "membershipOriginalPrice" REAL NOT NULL DEFAULT 58,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "Site" ("id", "hostname", "name", "singlePostPrice", "membershipPrice", "membershipOriginalPrice", "isDefault", "isActive")
VALUES ('a', 'fenglou1.com', CAST(X'E587A4E6A5BC' AS TEXT), 10, 38, 58, true, true);

CREATE UNIQUE INDEX "Site_hostname_key" ON "Site"("hostname");
CREATE INDEX "Site_isDefault_isActive_idx" ON "Site"("isDefault", "isActive");

CREATE TABLE "TeamAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamAccount_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TeamAccount_username_key" ON "TeamAccount"("username");
CREATE INDEX "TeamAccount_siteId_isActive_idx" ON "TeamAccount"("siteId", "isActive");

CREATE TABLE "TeamSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "teamAccountId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamSession_teamAccountId_fkey" FOREIGN KEY ("teamAccountId") REFERENCES "TeamAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TeamSession_teamAccountId_idx" ON "TeamSession"("teamAccountId");
CREATE INDEX "TeamSession_expiresAt_idx" ON "TeamSession"("expiresAt");

ALTER TABLE "User" ADD COLUMN "siteId" TEXT NOT NULL DEFAULT 'a';
ALTER TABLE "Order" ADD COLUMN "siteId" TEXT NOT NULL DEFAULT 'a';
ALTER TABLE "SiteVisit" ADD COLUMN "siteId" TEXT NOT NULL DEFAULT 'a';

CREATE INDEX "User_siteId_createdAt_idx" ON "User"("siteId", "createdAt");
CREATE INDEX "User_siteId_isMember_memberSince_idx" ON "User"("siteId", "isMember", "memberSince");
CREATE INDEX "Order_siteId_status_paidAt_idx" ON "Order"("siteId", "status", "paidAt");
CREATE INDEX "Order_siteId_createdAt_idx" ON "Order"("siteId", "createdAt");
CREATE INDEX "SiteVisit_siteId_lastVisitedAt_idx" ON "SiteVisit"("siteId", "lastVisitedAt");
