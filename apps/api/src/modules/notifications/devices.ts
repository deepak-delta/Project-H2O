import type { Tx } from '../../lib/db';

/** Stops every notification to this user's browsers and phones (access ended or removed). */
export async function forgetPushDevices(tx: Tx, userId: string): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { userId } });
  await tx.nativePushToken.deleteMany({ where: { userId } });
}
