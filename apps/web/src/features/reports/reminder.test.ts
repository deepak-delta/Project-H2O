import { describe, expect, it } from 'vitest';
import type { DuesBreakdown } from '@wd/shared';
import { MAX_REMINDER_LINES, reminderMessage } from './reminder';

const opts = {
  businessName: 'Aqua Supply',
  greet: 'Ravi',
  format: (a: string) => `₹${a}`,
  formatDate: (iso: string) => iso.slice(0, 10),
};

const base: DuesBreakdown = { storeId: 's', storeName: 'Shop', phone: '9876543210', balance: '0.00', broughtForward: '0.00', items: [] };

describe('reminderMessage', () => {
  it('lists unpaid bills oldest first, marks a part-paid bill and ends with the total', () => {
    const text = reminderMessage(
      {
        ...base,
        balance: '650.00',
        broughtForward: '50.00',
        items: [
          { orderId: 'a', orderNumber: 4, date: '2026-10-01T05:00:00Z', cans: 10, billed: '500.00', due: '200.00' },
          { orderId: 'b', orderNumber: 7, date: '2026-10-05T05:00:00Z', cans: 1, billed: '400.00', due: '400.00' },
        ],
      },
      opts,
    );
    expect(text).toContain('Hello Ravi, this is Aqua Supply.');
    expect(text).toContain('• 2026-10-01 · Order #4 · 10 cans · ₹200.00 (₹500.00 bill, part paid)');
    expect(text).toContain('• 2026-10-05 · Order #7 · 1 can · ₹400.00');
    expect(text).toContain('• Earlier balance · ₹50.00');
    expect(text.indexOf('Order #4')).toBeLessThan(text.indexOf('Order #7'));
    expect(text).toContain('*Total due: ₹650.00*');
  });

  it('shows just the earlier balance when no bill is unpaid (e.g. an opening balance)', () => {
    const text = reminderMessage({ ...base, balance: '300.00', broughtForward: '300.00' }, opts);
    expect(text).not.toContain('Unpaid deliveries');
    expect(text).toContain('Earlier balance: ₹300.00');
  });

  it('folds bills beyond the line limit into the earlier balance', () => {
    const items = Array.from({ length: MAX_REMINDER_LINES + 2 }, (_, n) => ({
      orderId: String(n),
      orderNumber: n + 1,
      date: '2026-10-01T05:00:00Z',
      cans: 1,
      billed: '10.00',
      due: '10.00',
    }));
    const text = reminderMessage({ ...base, balance: '270.00', items }, opts);
    expect(text).not.toContain('Order #1 ');
    expect(text).not.toContain('Order #2 ');
    expect(text).toContain('Order #3 ');
    expect(text).toContain('• Earlier balance · ₹20.00');
  });
});
