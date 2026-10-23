-- Read-only data integrity check: every running total must match the transactions behind it.
-- Safe on production: runs in a READ ONLY transaction and prints only counts (no names, phones or amounts).
-- Usage: psql "$DIRECT_URL" -X -q -f apps/api/scripts/integrity-check.sql   (0 problems on every line = healthy)
BEGIN READ ONLY;
\pset footer off
\pset format unaligned
\pset fieldsep ' | '
-- Each row: check name | problems found | rows checked. 0 problems = pass. Counts only, no personal data.
SELECT 'Client money balance = sum of its ledger' AS check, COUNT(*) FILTER (WHERE t.balance <> COALESCE(l.s,0)) AS problems, COUNT(*) AS checked
FROM "ClientTotals" t LEFT JOIN (SELECT "storeId", SUM(amount) s FROM "LedgerEntry" GROUP BY 1) l ON l."storeId" = t."storeId"
UNION ALL
SELECT 'Every client with ledger entries has a running total', COUNT(*) FILTER (WHERE t."storeId" IS NULL AND l.s <> 0), COUNT(*)
FROM (SELECT "storeId", SUM(amount) s FROM "LedgerEntry" GROUP BY 1) l LEFT JOIN "ClientTotals" t ON t."storeId" = l."storeId"
UNION ALL
SELECT 'Client cans held = sum of can movements', COUNT(*) FILTER (WHERE t.cans <> COALESCE(m.s,0)), COUNT(*)
FROM "ClientTotals" t LEFT JOIN (SELECT "storeId", SUM("withCustomersDelta") s FROM "InventoryMovement" WHERE "storeId" IS NOT NULL GROUP BY 1) m ON m."storeId" = t."storeId"
UNION ALL
SELECT 'Cans per client per product = movements', COUNT(*) FILTER (WHERE c.cans <> COALESCE(m.s,0)), COUNT(*)
FROM "ClientCans" c LEFT JOIN (SELECT "storeId","productId", SUM("withCustomersDelta") s FROM "InventoryMovement" WHERE "storeId" IS NOT NULL GROUP BY 1,2) m ON m."storeId" = c."storeId" AND m."productId" = c."productId"
UNION ALL
SELECT 'Stock (filled/empty/with clients/damaged) = movements', COUNT(*) FILTER (WHERE p.filled <> COALESCE(m.f,0) OR p.empty <> COALESCE(m.e,0) OR p."withCustomers" <> COALESCE(m.w,0) OR p.damaged <> COALESCE(m.d,0)), COUNT(*)
FROM "ProductStock" p LEFT JOIN (SELECT "productId", SUM("filledDelta") f, SUM("emptyDelta") e, SUM("withCustomersDelta") w, SUM("damagedDelta") d FROM "InventoryMovement" GROUP BY 1) m ON m."productId" = p."productId"
UNION ALL
SELECT 'Every payment has exactly one PAYMENT ledger entry for its amount', COUNT(*) FILTER (WHERE COALESCE(l.n,0) <> 1 OR l.s <> -p.amount), COUNT(*)
FROM "Payment" p LEFT JOIN (SELECT "paymentId", COUNT(*) n, SUM(amount) s FROM "LedgerEntry" WHERE type = 'PAYMENT' GROUP BY 1) l ON l."paymentId" = p.id
UNION ALL
SELECT 'Reversed payments are fully offset in the ledger', COUNT(*) FILTER (WHERE COALESCE(l.s,0) <> 0), COUNT(*)
FROM "Payment" p LEFT JOIN (SELECT "paymentId", SUM(amount) s FROM "LedgerEntry" WHERE "paymentId" IS NOT NULL GROUP BY 1) l ON l."paymentId" = p.id WHERE p."reversedAt" IS NOT NULL
UNION ALL
SELECT 'Cancelled orders leave no sale on the bill', COUNT(*) FILTER (WHERE COALESCE(l.s,0) <> 0), COUNT(*)
FROM "Order" o LEFT JOIN (SELECT "orderId", SUM(amount) s FROM "LedgerEntry" WHERE type IN ('SALE','DISCOUNT') OR (type='REVERSAL' AND "paymentId" IS NULL) GROUP BY 1) l ON l."orderId" = o.id WHERE o.status = 'CANCELLED'
UNION ALL
SELECT 'Delivered orders have a delivery record', COUNT(*) FILTER (WHERE d.n IS NULL), COUNT(*)
FROM "Order" o LEFT JOIN (SELECT "orderId", COUNT(*) n FROM "Delivery" GROUP BY 1) d ON d."orderId" = o.id WHERE o.status IN ('DELIVERED','PARTIALLY_DELIVERED')
UNION ALL
SELECT 'Sales are positive, payments negative', COUNT(*) FILTER (WHERE (type='SALE' AND amount < 0) OR (type='PAYMENT' AND amount > 0)), COUNT(*) FROM "LedgerEntry"
UNION ALL
SELECT 'Ledger entries belong to the client''s own business', COUNT(*) FILTER (WHERE l."supplierId" <> s."supplierId"), COUNT(*) FROM "LedgerEntry" l JOIN "Store" s ON s.id = l."storeId"
UNION ALL
SELECT 'Can movements belong to the product''s own business', COUNT(*) FILTER (WHERE m."supplierId" <> p."supplierId"), COUNT(*) FROM "InventoryMovement" m JOIN "Product" p ON p.id = m."productId"
UNION ALL
SELECT 'Orders belong to the client''s own business', COUNT(*) FILTER (WHERE o."supplierId" <> s."supplierId"), COUNT(*) FROM "Order" o JOIN "Store" s ON s.id = o."storeId"
UNION ALL
SELECT 'Orders given to staff of the same business', COUNT(*) FILTER (WHERE u."supplierId" <> o."supplierId" OR u.role <> 'STAFF'), COUNT(*) FROM "Order" o JOIN "User" u ON u.id = o."assignedToId"
UNION ALL
SELECT 'Payments belong to the client''s own business', COUNT(*) FILTER (WHERE p."supplierId" <> s."supplierId"), COUNT(*) FROM "Payment" p JOIN "Store" s ON s.id = p."storeId"
UNION ALL
SELECT 'Cash flow matches each payment (reversed ones net to zero)', COUNT(*) FILTER (WHERE COALESCE(c.s,0) <> CASE WHEN p."reversedAt" IS NULL THEN p.amount ELSE 0 END), COUNT(*)
FROM "Payment" p LEFT JOIN (SELECT "paymentId", SUM(CASE WHEN type='INCOME' THEN amount ELSE -amount END) s FROM "CashFlowEntry" WHERE "paymentId" IS NOT NULL GROUP BY 1) c ON c."paymentId" = p.id
UNION ALL
SELECT 'Order numbers unique within a business', COUNT(*) - COUNT(DISTINCT ("supplierId", "orderNumber")), COUNT(*) FROM "Order"
UNION ALL
SELECT 'Stored PINs are hashed (never plain digits)', COUNT(*) FILTER (WHERE "pinHash" ~ '^[0-9]{4,8}$'), COUNT(*) FROM "User"
UNION ALL
SELECT 'Sessions stored only as hashes (64-hex)', COUNT(*) FILTER (WHERE "tokenHash" !~ '^[0-9a-f]{64}$'), COUNT(*) FROM "Session";
\pset format aligned
SELECT 'Info: products with filled stock below zero' AS info, COUNT(*) FILTER (WHERE filled < 0) AS n FROM "ProductStock";
ROLLBACK;
