import type { FastifyRequest } from 'fastify';
import { forbidden, unauthenticated } from './errors';

export interface SupplierContext {
  role: 'SUPPLIER';
  userId: string;
  sessionId: string;
  supplierId: string;
  storeId: null;
}

export interface StoreContext {
  role: 'STORE';
  userId: string;
  sessionId: string;
  supplierId: string;
  storeId: string;
}

export type AuthContext = SupplierContext | StoreContext;

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export function requireSupplier(req: FastifyRequest): SupplierContext {
  const auth = requireAuth(req);
  if (auth.role !== 'SUPPLIER') throw forbidden();
  return auth;
}

export function requireStore(req: FastifyRequest): StoreContext {
  const auth = requireAuth(req);
  if (auth.role !== 'STORE') throw forbidden();
  return auth;
}

/**
 * The ownership filter every query must include. Supplier users see their whole business;
 * store users only ever see rows for their own store.
 */
export function ownedBy(auth: AuthContext): { supplierId: string; storeId?: string } {
  return auth.role === 'STORE'
    ? { supplierId: auth.supplierId, storeId: auth.storeId }
    : { supplierId: auth.supplierId };
}
