import { describe, expect, it } from 'vitest';
import { createStoreSchema } from './catalog';
import { moneySchema } from './common';
import { quickSaleSchema } from './sales';

describe('moneySchema', () => {
  it.each(['', 'abc', '1.234', '-5'])('reports "%s" as a validation issue instead of throwing', (value) => {
    const result = moneySchema().safeParse(value);
    expect(result.success).toBe(false);
  });

  it('accepts valid amounts and respects zero/negative options', () => {
    expect(moneySchema().safeParse('12.50').success).toBe(true);
    expect(moneySchema({ allowZero: false }).safeParse('0').success).toBe(false);
    expect(moneySchema({ allowNegative: true }).safeParse('-10').success).toBe(true);
  });
});

describe('createStoreSchema', () => {
  it('treats empty optional fields as null and its own output as valid input', () => {
    const parsed = createStoreSchema.parse({
      name: 'Sri Ganesh',
      ownerName: '',
      phone: '98111 22233',
      address: '',
      notes: '',
      creditLimit: '',
      openingBalance: '300',
      openingCans: [{ productId: 'p1', quantity: 5 }],
      prices: [{ productId: 'p1', price: '45' }],
    });
    expect(parsed).toMatchObject({ ownerName: null, phone: '+919811122233', creditLimit: null, openingBalance: '300' });
    expect(createStoreSchema.safeParse(parsed).success).toBe(true);
  });

  it('needs a positive price and only one price per product', () => {
    const store = (prices: unknown) => createStoreSchema.safeParse({ name: 'Sri Ganesh', prices }).success;
    expect(store([{ productId: 'p1', price: '45.50' }])).toBe(true);
    expect(store(undefined)).toBe(false);
    expect(store([{ productId: 'p1', price: '0' }])).toBe(false);
    expect(store([{ productId: 'p1', price: '-1' }])).toBe(false);
    expect(store([{ productId: 'p1', price: '40' }, { productId: 'p1', price: '50' }])).toBe(false);
  });
});

describe('quickSaleSchema', () => {
  const base = {
    clientId: '6f1c2c1e-8a8b-4c5c-9d7e-1a2b3c4d5e6f',
    storeId: 's1',
    payment: { amount: '0' },
  };

  it('needs at least one delivered can', () => {
    const result = quickSaleSchema.safeParse({ ...base, items: [{ productId: 'p1', quantity: 0, emptyCollected: 3 }] });
    expect(result.success).toBe(false);
  });

  it('rejects the same product twice', () => {
    const result = quickSaleSchema.safeParse({
      ...base,
      items: [
        { productId: 'p1', quantity: 1 },
        { productId: 'p1', quantity: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
