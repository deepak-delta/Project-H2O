import type { OrderStatus, PaymentStatus } from '@wd/shared';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'brand';

const tones: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-line/70 text-ink-2',
  brand: 'bg-brand-50 text-brand-700',
};

/** Status label. Always carries text, so meaning never depends on colour alone. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

const PAYMENT: Record<PaymentStatus, { tone: Tone; label: string }> = {
  PAID: { tone: 'ok', label: 'Paid' },
  PARTIAL: { tone: 'warn', label: 'Part paid' },
  UNPAID: { tone: 'bad', label: 'On credit' },
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const p = PAYMENT[status];
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

const ORDER: Record<OrderStatus, { tone: Tone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  PENDING: { tone: 'warn', label: 'Pending' },
  CONFIRMED: { tone: 'brand', label: 'Confirmed' },
  OUT_FOR_DELIVERY: { tone: 'brand', label: 'On the way' },
  DELIVERED: { tone: 'ok', label: 'Delivered' },
  PARTIALLY_DELIVERED: { tone: 'warn', label: 'Part delivered' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const o = ORDER[status];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}
