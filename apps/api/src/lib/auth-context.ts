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

/** Delivery staff: works for the business, but sees only their own work for today. */
export interface StaffContext {
  role: 'STAFF';
  userId: string;
  sessionId: string;
  supplierId: string;
  storeId: null;
}

export type AuthContext = SupplierContext | StoreContext | StaffContext;

/** Someone who records the business's work: the owner or a member of staff. */
export type OperatorContext = SupplierContext | StaffContext;

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

/** Owner or delivery staff (deliveries, payments, empties, expenses). */
export function requireOperator(req: FastifyRequest): OperatorContext {
  const auth = requireAuth(req);
  if (auth.role === 'STORE') throw forbidden();
  return auth;
}

/** The owner or a store owner; never staff (history, cancelling, placing orders). */
export function requireOwnerOrStore(req: FastifyRequest): SupplierContext | StoreContext {
  const auth = requireAuth(req);
  if (auth.role === 'STAFF') throw forbidden();
  return auth;
}

export function requireStore(req: FastifyRequest): StoreContext {
  const auth = requireAuth(req);
  if (auth.role !== 'STORE') throw forbidden();
  return auth;
}

/**
 * The ownership filter every query must include. Supplier users see their whole business;
 * store users only ever see rows for their own store. Staff are deliberately not accepted here:
 * their scope (own work, today) is different for each kind of data and is applied explicitly.
 */
export function ownedBy(auth: SupplierContext | StoreContext): { supplierId: string; storeId?: string } {
  return auth.role === 'STORE'
    ? { supplierId: auth.supplierId, storeId: auth.storeId }
    : { supplierId: auth.supplierId };
}
