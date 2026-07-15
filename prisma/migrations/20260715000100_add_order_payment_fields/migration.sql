ALTER TABLE "Order" ADD COLUMN "merchantOrderNo" TEXT;
ALTER TABLE "Order" ADD COLUMN "providerTradeNo" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentExpiresAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "paymentCheckedAt" DATETIME;

CREATE UNIQUE INDEX "Order_merchantOrderNo_key" ON "Order"("merchantOrderNo");
CREATE UNIQUE INDEX "Order_providerTradeNo_key" ON "Order"("providerTradeNo");
