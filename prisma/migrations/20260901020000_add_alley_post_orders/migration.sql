ALTER TABLE "Order" ADD COLUMN "productType" TEXT NOT NULL DEFAULT 'membership';
ALTER TABLE "Order" ADD COLUMN "alleyPostId" INTEGER;

CREATE INDEX "Order_userId_productType_alleyPostId_status_idx"
ON "Order"("userId", "productType", "alleyPostId", "status");
