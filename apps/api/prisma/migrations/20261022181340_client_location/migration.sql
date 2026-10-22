-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "mapLink" TEXT;

-- CreateIndex
CREATE INDEX "Order_storeId_updatedAt_idx" ON "Order"("storeId", "updatedAt");
