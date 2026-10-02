import { productInputSchema, type ProductDto } from '@wd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { requireAuth, requireSupplier } from '../../lib/auth-context';
import { notFound, validationError } from '../../lib/errors';
import { decToString } from '../../lib/money';
import { parse } from '../../lib/validate';
import type { Product } from '../../generated/prisma/client';

export function toProductDto(p: Product): ProductDto {
  return {
    id: p.id,
    name: p.name,
    capacityLiters: p.capacityLiters ? p.capacityLiters.toString() : null,
    sellingPrice: decToString(p.sellingPrice),
    depositAmount: decToString(p.depositAmount),
    isReturnable: p.isReturnable,
    active: p.active,
  };
}

export function registerProductRoutes(app: FastifyInstance, { db }: AppDeps): void {
  // Store users can read the catalogue (to place orders); only suppliers can change it.
  app.get('/api/products', async (req) => {
    const auth = requireAuth(req);
    const { all } = parse(z.object({ all: z.enum(['true', 'false']).optional() }), req.query);
    const products = await db.product.findMany({
      where: {
        supplierId: auth.supplierId,
        ...(all === 'true' && auth.role === 'SUPPLIER' ? {} : { active: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return products.map(toProductDto);
  });

  app.post('/api/products', async (req, reply) => {
    const auth = requireSupplier(req);
    const input = parse(productInputSchema, req.body);
    const count = await db.product.count({ where: { supplierId: auth.supplierId } });
    const product = await db.product.create({
      data: {
        supplierId: auth.supplierId,
        createdById: auth.userId,
        name: input.name,
        capacityLiters: input.capacityLiters ?? null,
        sellingPrice: input.sellingPrice,
        depositAmount: input.depositAmount,
        isReturnable: input.isReturnable,
        active: input.active,
        sortOrder: count,
      },
    });
    return reply.status(201).send(toProductDto(product));
  });

  app.patch('/api/products/:id', async (req) => {
    const auth = requireSupplier(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const input = parse(productInputSchema, req.body);
    const existing = await db.product.findFirst({ where: { id, supplierId: auth.supplierId } });
    if (!existing) throw notFound('Product');

    if (existing.isReturnable !== input.isReturnable) {
      const used = await db.inventoryMovement.count({ where: { supplierId: auth.supplierId, productId: id } });
      if (used > 0) {
        throw validationError(
          'This product already has stock history, so whether cans are returned cannot be changed. Create a new product instead.',
          { isReturnable: 'Cannot change after stock has been recorded' },
        );
      }
    }

    // Price changes only affect future sales: past orders keep their own unit prices.
    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          name: input.name,
          capacityLiters: input.capacityLiters ?? null,
          sellingPrice: input.sellingPrice,
          depositAmount: input.depositAmount,
          isReturnable: input.isReturnable,
          active: input.active,
        },
      });
      if (!existing.sellingPrice.equals(updated.sellingPrice)) {
        await tx.auditLog.create({
          data: {
            supplierId: auth.supplierId,
            actorId: auth.userId,
            action: 'PRICE_CHANGED',
            entity: 'Product',
            entityId: id,
            before: { sellingPrice: decToString(existing.sellingPrice) },
            after: { sellingPrice: decToString(updated.sellingPrice) },
          },
        });
      }
      return updated;
    });
    return toProductDto(product);
  });
}
