-- Additive-only migration: existing collaborator rows and their 30/150 limits
-- remain untouched. New/changed accounts store their 22/150 base quota in the
-- override column so the old database CHECK constraint does not need rebuilding.
ALTER TABLE "TeamAccount"
ADD COLUMN "monthlyPostLimitOverride" INTEGER
CHECK (
    "monthlyPostLimitOverride" IS NULL
    OR "monthlyPostLimitOverride" IN (22, 150)
);

ALTER TABLE "TeamAccount"
ADD COLUMN "monthlyPostBonus" INTEGER NOT NULL DEFAULT 0
CHECK ("monthlyPostBonus" >= 0);

ALTER TABLE "TeamAccount"
ADD COLUMN "monthlyPostBonusMonth" TEXT;
