import { addMoney, type DuesBreakdown } from '@wd/shared';

/** Bills listed one by one; anything older is added to the earlier balance line. */
export const MAX_REMINDER_LINES = 25;

interface ReminderOptions {
  businessName: string;
  /** Who the message greets: the owner if known, else the shop. */
  greet: string;
  format: (amount: string) => string;
  formatDate: (iso: string) => string;
}

/** The WhatsApp reminder: what's owed, bill by bill, oldest first, and the total. */
export function reminderMessage(dues: DuesBreakdown, { businessName, greet, format, formatDate }: ReminderOptions): string {
  const folded = dues.items.slice(0, Math.max(0, dues.items.length - MAX_REMINDER_LINES));
  const listed = dues.items.slice(folded.length);
  const earlier = addMoney(dues.broughtForward, ...folded.map((i) => i.due));

  const lines = [`Hello ${greet}, this is ${businessName}.`, '', `Your water bill: *${format(dues.balance)}* due.`];
  if (listed.length > 0) {
    lines.push('', 'Unpaid deliveries:');
    for (const i of listed) {
      const cans = i.cans > 0 ? ` · ${i.cans} can${i.cans === 1 ? '' : 's'}` : '';
      const part = i.due === i.billed ? '' : ` (${format(i.billed)} bill, part paid)`;
      lines.push(`• ${formatDate(i.date)} · Order #${i.orderNumber}${cans} · ${format(i.due)}${part}`);
    }
  }
  if (earlier !== '0.00') lines.push(listed.length > 0 ? `• Earlier balance · ${format(earlier)}` : `Earlier balance: ${format(earlier)}`);
  lines.push('', `*Total due: ${format(dues.balance)}*`, 'Please pay when convenient. Thank you!');
  return lines.join('\n');
}
