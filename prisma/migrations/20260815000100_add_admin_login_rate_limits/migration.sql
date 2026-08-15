CREATE TABLE "AdminLoginRateLimit" (
    "keyHash" TEXT NOT NULL PRIMARY KEY,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "AdminLoginRateLimit_expiresAt_idx" ON "AdminLoginRateLimit"("expiresAt");
