-- CreateIndex
CREATE INDEX "InventoryMovement_supplierId_createdAt_idx" ON "InventoryMovement"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_supplierId_updatedAt_idx" ON "Order"("supplierId", "updatedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_supplierId_createdAt_idx" ON "LedgerEntry"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "CashFlowEntry_supplierId_createdAt_idx" ON "CashFlowEntry"("supplierId", "createdAt");

