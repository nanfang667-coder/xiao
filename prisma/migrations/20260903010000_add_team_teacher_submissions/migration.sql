-- CreateTable
CREATE TABLE "TeacherOwnership" (
    "teacherId" INTEGER NOT NULL PRIMARY KEY,
    "teamAccountId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherOwnership_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeacherOwnership_teamAccountId_fkey" FOREIGN KEY ("teamAccountId") REFERENCES "TeamAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "teamAccountId" INTEGER NOT NULL,
    "siteId" TEXT NOT NULL,
    "teacherId" INTEGER,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "services" TEXT NOT NULL,
    "courseNotes" TEXT,
    "age" TEXT,
    "photos" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wechat" TEXT NOT NULL,
    "qq" TEXT,
    "otherContact" TEXT,
    "address" TEXT,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reviewedAt" DATETIME,
    CHECK ("kind" IN ('create', 'update')),
    CHECK ("status" IN ('pending', 'approved', 'rejected')),
    CONSTRAINT "TeacherSubmission_teamAccountId_fkey" FOREIGN KEY ("teamAccountId") REFERENCES "TeamAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeacherSubmission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeacherSubmission_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeacherOwnership_teamAccountId_createdAt_idx" ON "TeacherOwnership"("teamAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherSubmission_status_createdAt_idx" ON "TeacherSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherSubmission_teamAccountId_status_updatedAt_idx" ON "TeacherSubmission"("teamAccountId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "TeacherSubmission_teacherId_status_idx" ON "TeacherSubmission"("teacherId", "status");

-- CreateIndex
CREATE INDEX "TeacherSubmission_siteId_status_idx" ON "TeacherSubmission"("siteId", "status");
