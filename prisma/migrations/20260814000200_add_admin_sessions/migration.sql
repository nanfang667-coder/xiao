CREATE TABLE "AdminSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");