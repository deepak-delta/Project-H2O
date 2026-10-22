import { addMoney, compareMoney, subtractMoney, type DuesBreakdown } from '@wd/shared';

/** Orders listed one by one; older unpaid orders are added up on one line. */
export const MAX_REMINDER_ORDERS = 25;
/** Payments listed one by one; older ones are added up on one line. */
export const MAX_REMINDER_CREDITS = 10;

interface ReminderOptions {
  businessName: string;
  /** Who the message greets: the owner if known, else the shop. */
  greet: string;
  format: (amount: string) => string;
  formatDate: (iso: string) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The WhatsApp reminder: every order not fully paid with its own bill, paid and due, then
 * money paid that isn't for one of those orders on separate lines, and the total.
 */
export function reminderMessage(dues: DuesBreakdown, { businessName, greet, format, formatDate }: ReminderOptions): string {
  const minus = (amount: string) => `−${format(amount)}`;
  const olderOrders = dues.orders.slice(0, Math.max(0, dues.orders.length - MAX_REMINDER_ORDERS));
  const orders = dues.orders.slice(olderOrders.length);
  const olderCredits = dues.credits.slice(0, Math.max(0, dues.credits.length - MAX_REMINDER_CREDITS));
  const credits = dues.credits.slice(olderCredits.length);

  const lines = [`Hello ${greet}, this is ${businessName}.`, '', `Your water bill: *${format(dues.balance)}* due.`];

  if (orders.length > 0 || olderOrders.length > 0) {
    lines.push('', 'Unpaid orders:');
    if (olderOrders.length > 0) {
      lines.push(`• ${plural(olderOrders.length, 'earlier order')} · Due ${format(addMoney(...olderOrders.map((o) => o.due)))}`);
    }
    for (const o of orders) {
      const cans = o.cans > 0 ? ` · ${plural(o.cans, 'can')}` : '';
      lines.push(`• ${formatDate(o.date)} · Order #${o.orderNumber}${cans}`, `   Bill ${format(o.billed)} · Paid ${format(o.paid)} · Due ${format(o.due)}`);
    }
  }

  const other: string[] = [];
  const earlier = compareMoney(dues.broughtForward, '0.00');
  if (earlier > 0) other.push(`Earlier balance: ${format(dues.broughtForward)}`);
  if (earlier < 0) other.push(`Advance paid earlier: ${minus(subtractMoney('0.00', dues.broughtForward))}`);
  if (olderCredits.length > 0) other.push(`Earlier payments: ${minus(addMoney(...olderCredits.map((c) => c.amount)))}`);
  for (const c of credits) {
    other.push(
      c.kind === 'EXTRA'
        ? `Extra paid on order #${c.orderNumber ?? ''}: ${minus(c.amount)}`
        : `Paid on ${formatDate(c.date)}: ${minus(c.amount)}`,
    );
  }
  if (other.length > 0) lines.push('', ...other);

  lines.push('', `*Total due: ${format(dues.balance)}*`, 'Please pay when convenient. Thank you!');
  return lines.join('\n');
}
