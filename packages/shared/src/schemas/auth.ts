import { z } from 'zod';
import type { Role } from '../enums';
import { phoneSchema, pinSchema } from './common';

export const signupSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name').max(80),
  ownerName: z.string().trim().min(2, 'Enter your name').max(80),
  phone: phoneSchema,
  pin: pinSchema,
});
export type SignupInput = z.input<typeof signupSchema>;

export const pinLoginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
});
export type PinLoginInput = z.input<typeof pinLoginSchema>;

export const changePinSchema = z
  .object({
    currentPin: pinSchema,
    newPin: pinSchema,
  })
  .refine((v) => v.currentPin !== v.newPin, {
    message: 'New PIN must be different',
    path: ['newPin'],
  });
export type ChangePinInput = z.input<typeof changePinSchema>;

export const passkeyRenameSchema = z.object({
  deviceName: z.string().trim().min(1).max(60),
});

export interface SessionUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  supplierId: string;
  storeId: string | null;
}

export interface SessionBusiness {
  id: string;
  businessName: string;
  currency: string;
  timezone: string;
}

export interface MeResponse {
  user: SessionUser;
  business: SessionBusiness;
  store: { id: string; name: string } | null;
  hasPasskey: boolean;
}

export interface PasskeySummary {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}
