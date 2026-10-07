-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "assignedToId" TEXT;

-- CreateIndex
CREATE INDEX "Order_supplierId_assignedToId_status_idx" ON "Order"("supplierId", "assignedToId", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

