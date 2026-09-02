ALTER TABLE "Order" ADD COLUMN "teacherPostId" INTEGER;

CREATE INDEX "Order_userId_productType_teacherPostId_status_idx"
ON "Order"("userId", "productType", "teacherPostId", "status");