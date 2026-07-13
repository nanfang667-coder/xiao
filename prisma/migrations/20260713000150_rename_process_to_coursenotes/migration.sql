-- 补记录：这一步实际是之前用 `prisma db push` 把 "process" 列改名成 "courseNotes"，
-- 当时没有走 migrate 留下迁移文件，导致 shadow database 重放历史时缺这一步。
-- 这里补上迁移文件让历史完整；真实数据库已经是 courseNotes，用 migrate resolve 标记为已应用，不会真的执行这条 SQL。
ALTER TABLE "Teacher" RENAME COLUMN "process" TO "courseNotes";
