UPDATE "Teacher"
SET "courseNotes" = CASE
  WHEN instr("courseNotes", char(10) || '其他联系方式：') > 0
    THEN substr("courseNotes", 1, instr("courseNotes", char(10) || '其他联系方式：') - 1)
  WHEN instr("courseNotes", char(10) || '地址：') > 0
    THEN substr("courseNotes", 1, instr("courseNotes", char(10) || '地址：') - 1)
  ELSE "courseNotes"
END
WHERE "source" = 'lfgapi' AND "courseNotes" IS NOT NULL;
