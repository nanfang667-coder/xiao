ALTER TABLE "Teacher" ADD COLUMN "promotionOrder" INTEGER NOT NULL DEFAULT 100;

DROP INDEX "Teacher_isNationallyPromoted_promotionStartsAt_promotionEndsAt_idx";

CREATE INDEX "Teacher_isNationallyPromoted_promotionOrder_promotionStartsAt_promotionEndsAt_idx"
ON "Teacher"("isNationallyPromoted", "promotionOrder", "promotionStartsAt", "promotionEndsAt");
