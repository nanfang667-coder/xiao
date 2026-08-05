ALTER TABLE "Teacher" ADD COLUMN "isNationallyPromoted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Teacher" ADD COLUMN "promotionStartsAt" DATETIME;
ALTER TABLE "Teacher" ADD COLUMN "promotionEndsAt" DATETIME;

CREATE INDEX "Teacher_isNationallyPromoted_promotionStartsAt_promotionEndsAt_idx"
ON "Teacher"("isNationallyPromoted", "promotionStartsAt", "promotionEndsAt");
