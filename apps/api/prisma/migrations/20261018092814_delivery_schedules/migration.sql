-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'EVERY_N_DAYS', 'MONTHLY');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "DeliverySchedule" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "weekdays" INTEGER[],
    "intervalDays" INTEGER,
    "monthDays" INTEGER[],
    "startDate" DATE NOT NULL,
    "assignedToId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryScheduleItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DeliveryScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySchedule_storeId_key" ON "DeliverySchedule"("storeId");

-- CreateIndex
CREATE INDEX "DeliverySchedule_supplierId_active_idx" ON "DeliverySchedule"("supplierId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryScheduleItem_scheduleId_productId_key" ON "DeliveryScheduleItem"("scheduleId", "productId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DeliverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryScheduleItem" ADD CONSTRAINT "DeliveryScheduleItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DeliverySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryScheduleItem" ADD CONSTRAINT "DeliveryScheduleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
