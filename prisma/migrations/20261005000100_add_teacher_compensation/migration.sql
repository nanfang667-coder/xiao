-- Existing and newly published posts hide the badge until an administrator enables it.
ALTER TABLE "Teacher" ADD COLUMN "supportsCompensation" BOOLEAN NOT NULL DEFAULT false;
