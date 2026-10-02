import { z } from 'zod';

const endpoint = z
  .url({ protocol: /^https$/, message: 'Invalid push endpoint' })
  .max(1000);

/** Shape of `PushSubscription.toJSON()` from the browser. */
export const pushSubscribeSchema = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type PushSubscribeInput = z.input<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint });

export interface PushConfig {
  /** False when the server has no VAPID keys (notifications switched off). */
  enabled: boolean;
  publicKey: string | null;
}
