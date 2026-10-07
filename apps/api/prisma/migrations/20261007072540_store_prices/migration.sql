-- Prices are now agreed per store. Every existing store keeps paying what it paid before:
-- its price for each product starts as that product's old list price.

-- CreateTable
CREATE TABLE "StorePrice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorePrice_supplierId_productId_updatedAt_idx" ON "StorePrice"("supplierId", "productId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorePrice_storeId_productId_key" ON "StorePrice"("storeId", "productId");

-- AddForeignKey
ALTER TABLE "StorePrice" ADD CONSTRAINT "StorePrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePrice" ADD CONSTRAINT "StorePrice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePrice" ADD CONSTRAINT "StorePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one price per (store, product) of the same business, from the old list price.
INSERT INTO "StorePrice" ("id", "supplierId", "storeId", "productId", "price", "updatedAt")
SELECT 'sp_' || md5(s."id" || ':' || p."id"), s."supplierId", s."id", p."id", p."sellingPrice", CURRENT_TIMESTAMP
FROM "Store" s
JOIN "Product" p ON p."supplierId" = s."supplierId";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "sellingPrice";
