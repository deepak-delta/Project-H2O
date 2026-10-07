import type { ClientCategory } from '@wd/shared';

export const CLIENT_TYPE_LABEL: Record<ClientCategory, string> = {
  STORE: 'Store',
  HOME: 'Home',
  INDIVIDUAL: 'Individual',
  OTHER: 'Other',
};

/** "Store", "Home", … or the owner's own word for an "Other" client. */
export function clientTypeLabel(c: { category: ClientCategory; categoryOther: string | null }): string {
  return c.category === 'OTHER' && c.categoryOther ? c.categoryOther : CLIENT_TYPE_LABEL[c.category];
}
