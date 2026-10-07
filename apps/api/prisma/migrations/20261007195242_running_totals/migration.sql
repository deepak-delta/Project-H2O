-- CreateTable
CREATE TABLE "ProductStock" (
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "empty" INTEGER NOT NULL DEFAULT 0,
    "withCustomers" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductStock_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ClientTotals" (
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cans" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),

    CONSTRAINT "ClientTotals_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "ClientCans" (
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "cans" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClientCans_pkey" PRIMARY KEY ("storeId","productId")
);

-- CreateIndex
CREATE INDEX "ProductStock_supplierId_idx" ON "ProductStock"("supplierId");

-- CreateIndex
CREATE INDEX "ClientTotals_supplierId_balance_idx" ON "ClientTotals"("supplierId", "balance");

-- CreateIndex
CREATE INDEX "ClientCans_supplierId_productId_idx" ON "ClientCans"("supplierId", "productId");

-- AddForeignKey
ALTER TABLE "ProductStock" ADD CONSTRAINT "ProductStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTotals" ADD CONSTRAINT "ClientTotals_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCans" ADD CONSTRAINT "ClientCans_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCans" ADD CONSTRAINT "ClientCans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Running totals, kept by the database itself ─────────────────────────────
-- Screens used to add up every ledger row / stock movement ever recorded (slower every day,
-- and per sale). These triggers keep the totals current in the same transaction as each insert,
-- so they always equal a full recount. The history tables stay the source of truth.

CREATE FUNCTION wd_apply_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ProductStock" ("productId", "supplierId", "filled", "empty", "withCustomers", "damaged")
  VALUES (NEW."productId", NEW."supplierId", NEW."filledDelta", NEW."emptyDelta", NEW."withCustomersDelta", NEW."damagedDelta")
  ON CONFLICT ("productId") DO UPDATE SET
    "filled" = "ProductStock"."filled" + EXCLUDED."filled",
    "empty" = "ProductStock"."empty" + EXCLUDED."empty",
    "withCustomers" = "ProductStock"."withCustomers" + EXCLUDED."withCustomers",
    "damaged" = "ProductStock"."damaged" + EXCLUDED."damaged";

  IF NEW."storeId" IS NOT NULL THEN
    IF NEW."withCustomersDelta" <> 0 THEN
      INSERT INTO "ClientCans" ("storeId", "productId", "supplierId", "cans")
      VALUES (NEW."storeId", NEW."productId", NEW."supplierId", NEW."withCustomersDelta")
      ON CONFLICT ("storeId", "productId") DO UPDATE SET "cans" = "ClientCans"."cans" + EXCLUDED."cans";
    END IF;
    INSERT INTO "ClientTotals" ("storeId", "supplierId", "cans", "lastDeliveryAt")
    VALUES (NEW."storeId", NEW."supplierId", NEW."withCustomersDelta", CASE WHEN NEW."type" = 'DELIVERY' THEN NEW."occurredAt" END)
    ON CONFLICT ("storeId") DO UPDATE SET
      "cans" = "ClientTotals"."cans" + EXCLUDED."cans",
      "lastDeliveryAt" = GREATEST("ClientTotals"."lastDeliveryAt", EXCLUDED."lastDeliveryAt");
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "InventoryMovement_running_totals" AFTER INSERT ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION wd_apply_movement();

CREATE FUNCTION wd_apply_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ClientTotals" ("storeId", "supplierId", "balance")
  VALUES (NEW."storeId", NEW."supplierId", NEW."amount")
  ON CONFLICT ("storeId") DO UPDATE SET "balance" = "ClientTotals"."balance" + EXCLUDED."balance";
  RETURN NULL;
END $$;

CREATE TRIGGER "LedgerEntry_running_totals" AFTER INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION wd_apply_ledger();

-- Money and stock history is append-only (mistakes are reversed with new rows). Enforce it, so
-- the running totals can never drift from the history.
CREATE FUNCTION wd_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only; record a reversal or correction instead', TG_TABLE_NAME;
END $$;

CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION wd_append_only();
CREATE TRIGGER "InventoryMovement_append_only" BEFORE UPDATE OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION wd_append_only();

-- Backfill from the existing history.
INSERT INTO "ProductStock" ("productId", "supplierId", "filled", "empty", "withCustomers", "damaged")
SELECT "productId", MIN("supplierId"), SUM("filledDelta"), SUM("emptyDelta"), SUM("withCustomersDelta"), SUM("damagedDelta")
FROM "InventoryMovement" GROUP BY "productId";

INSERT INTO "ClientCans" ("storeId", "productId", "supplierId", "cans")
SELECT "storeId", "productId", MIN("supplierId"), SUM("withCustomersDelta")
FROM "InventoryMovement" WHERE "storeId" IS NOT NULL
GROUP BY "storeId", "productId" HAVING SUM("withCustomersDelta") <> 0;

INSERT INTO "ClientTotals" ("storeId", "supplierId", "balance", "cans", "lastDeliveryAt")
SELECT s."id", s."supplierId",
       COALESCE((SELECT SUM(l."amount") FROM "LedgerEntry" l WHERE l."storeId" = s."id"), 0),
       COALESCE((SELECT SUM(m."withCustomersDelta") FROM "InventoryMovement" m WHERE m."storeId" = s."id"), 0),
       (SELECT MAX(m."occurredAt") FROM "InventoryMovement" m WHERE m."storeId" = s."id" AND m."type" = 'DELIVERY')
FROM "Store" s;
