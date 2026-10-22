import { describe, expect, it } from 'vitest';
import type { DuesBreakdown } from '@wd/shared';
import { MAX_REMINDER_CREDITS, MAX_REMINDER_ORDERS, reminderMessage } from './reminder';

const opts = {
  businessName: 'Aqua Supply',
  greet: 'Ravi',
  format: (a: string) => `₹${a}`,
  formatDate: (iso: string) => iso.slice(0, 10),
};

const base: DuesBreakdown = { storeId: 's', storeName: 'Shop', phone: '+919876543210', balance: '0.00', broughtForward: '0.00', orders: [], credits: [] };
const order = (n: number, billed: string, paid: string, due: string, cans = 1) => ({
  orderId: `o${n}`,
  orderNumber: n,
  date: `2026-10-${String(n).padStart(2, '0')}T05:00:00Z`,
  cans,
  billed,
  paid,
  due,
});

describe('reminderMessage', () => {
  it('shows each order with its own bill, paid and due, then other payments and the total', () => {
    const text = reminderMessage(
      {
        ...base,
        balance: '450.00',
        broughtForward: '50.00',
        orders: [order(4, '500.00', '200.00', '300.00', 10), order(7, '400.00', '0.00', '400.00', 8)],
        credits: [
          { kind: 'EXTRA', date: '2026-10-05T05:00:00Z', amount: '100.00', orderNumber: 5 },
          { kind: 'PAYMENT', date: '2026-10-09T05:00:00Z', amount: '200.00', orderNumber: null },
        ],
      },
      opts,
    );
    expect(text).toContain('Hello Ravi, this is Aqua Supply.');
    expect(text).toContain('• 2026-10-04 · Order #4 · 10 cans\n   Bill ₹500.00 · Paid ₹200.00 · Due ₹300.00');
    expect(text).toContain('• 2026-10-07 · Order #7 · 8 cans\n   Bill ₹400.00 · Paid ₹0.00 · Due ₹400.00');
    expect(text).toContain('Earlier balance: ₹50.00');
    expect(text).toContain('Extra paid on order #5: −₹100.00');
    expect(text).toContain('Paid on 2026-10-09: −₹200.00');
    expect(text.indexOf('Order #4')).toBeLessThan(text.indexOf('Order #7'));
    expect(text).toContain('*Total due: ₹450.00*');
  });

  it('shows an advance from before as money off', () => {
    const text = reminderMessage({ ...base, balance: '150.00', broughtForward: '-50.00', orders: [order(2, '200.00', '0.00', '200.00')] }, opts);
    expect(text).toContain('Advance paid earlier: −₹50.00');
  });

  it('shows just the earlier balance when no order is unpaid (e.g. an opening balance)', () => {
    const text = reminderMessage({ ...base, balance: '300.00', broughtForward: '300.00' }, opts);
    expect(text).not.toContain('Unpaid orders');
    expect(text).toContain('Earlier balance: ₹300.00');
  });

  it('adds up orders and payments beyond the line limits on one line each', () => {
    const orders = Array.from({ length: MAX_REMINDER_ORDERS + 2 }, (_, n) => order(n + 1, '10.00', '0.00', '10.00'));
    const credits = Array.from({ length: MAX_REMINDER_CREDITS + 3 }, (_, n) => ({
      kind: 'PAYMENT' as const,
      date: `2026-11-${String(n + 1).padStart(2, '0')}T05:00:00Z`,
      amount: '1.00',
      orderNumber: null,
    }));
    const text = reminderMessage({ ...base, balance: '257.00', orders, credits }, opts);
    expect(text).toContain('• 2 earlier orders · Due ₹20.00');
    expect(text).not.toContain('Order #2 ');
    expect(text).toContain('Order #3 ');
    expect(text).toContain('Earlier payments: −₹3.00');
    expect(text).not.toContain('Paid on 2026-11-03');
    expect(text).toContain('Paid on 2026-11-04');
  });
});
