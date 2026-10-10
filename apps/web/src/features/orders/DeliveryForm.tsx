import { fromMinor, isMoneyString, lineTotalMinor, toMinor, type PaymentMethod, type QuickSaleResult, type StoreDetail } from '@wd/shared';
import { CircleAlert, CircleCheck, CloudOff, MessageCircle, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Segmented } from '../../components/ui/Segmented';
import { BalanceText } from '../../components/ui/Stat';
import { useMoney } from '../../hooks/useMoney';

type PayMode = 'full' | 'other' | 'credit';

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank' },
  { value: 'OTHER', label: 'Other' },
];

export interface DeliveryLine {
  productId: string;
  name: string;
  /** This store's price; null when the store has no price for the product yet (asked here). */
  unitPrice: string | null;
  isReturnable: boolean;
  /** Prefilled quantity (last order, or what is still to be delivered). */
  initialQty: number;
  /** Extra context under the product name, e.g. "Ordered 10 · 6 delivered". */
  note?: string;
}

export interface DeliveryValues {
  /** `unitPrice` only for products the store had no price for: it becomes the store's price. */
  items: { productId: string; quantity: number; emptyCollected: number; damagedCollected: number; unitPrice?: string }[];
  payment: { amount: string; method: PaymentMethod };
}

/** Worked out on the phone, so a sale saved offline can still be confirmed to the user. */
export interface DeliveryTotals {
  total: string;
  paid: string;
  cans: number;
  empties: number;
  damaged: number;
}

interface DeliveryFormProps {
  store: Pick<StoreDetail, 'id' | 'name' | 'balance' | 'creditLimit' | 'cansOutstanding' | 'cans'>;
  lines: DeliveryLine[];
  title?: string;
  back: string | true;
  headerAction?: ReactNode;
  /** Shown above the form, e.g. the owner's "Deliver now / For later" switch. */
  top?: ReactNode;
  pending: boolean;
  error: string | null;
  onSubmit: (values: DeliveryValues, totals: DeliveryTotals) => void;
}

/**
 * Quantities → empties → payment → confirm, on one screen with a sticky confirm button.
 * Used for quick sales and for delivering orders that were placed earlier.
 */
export function DeliveryForm({ store, lines, title, back, headerAction, top, pending, error, onSubmit }: DeliveryFormProps) {
  const format = useMoney();
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.productId, l.initialQty])));
  const [empties, setEmpties] = useState<Record<string, number>>({});
  // Broken cans handed back: rare, so tucked away behind a button until needed.
  const [damaged, setDamaged] = useState<Record<string, number>>({});
  const [showDamaged, setShowDamaged] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>('full');
  const [otherAmount, setOtherAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [localError, setLocalError] = useState<string | null>(null);
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});

  const heldBy = useMemo(() => new Map(store.cans.map((c) => [c.productId, c.quantity])), [store.cans]);
  const newPriceValid = (productId: string) => isMoneyString(newPrices[productId] ?? '') && toMinor(newPrices[productId] ?? '0') > 0;
  const priceMinor = (l: DeliveryLine) => (l.unitPrice !== null ? toMinor(l.unitPrice) : newPriceValid(l.productId) ? toMinor(newPrices[l.productId] ?? '0') : 0);
  const totalMinor = lines.reduce((sum, l) => sum + lineTotalMinor(priceMinor(l), quantities[l.productId] ?? 0), 0);
  const unpriced = lines.filter((l) => l.unitPrice === null && (quantities[l.productId] ?? 0) > 0);
  const otherValid = isMoneyString(otherAmount) && toMinor(otherAmount) >= 0;
  const paidMinor = payMode === 'full' ? totalMinor : payMode === 'credit' ? 0 : otherValid ? toMinor(otherAmount) : 0;
  const balanceMinor = toMinor(store.balance);
  const newBalanceMinor = balanceMinor + totalMinor - paidMinor;
  const totalCans = Object.values(quantities).reduce((a, b) => a + b, 0);
  const overLimit = store.creditLimit !== null && newBalanceMinor > toMinor(store.creditLimit) && newBalanceMinor > balanceMinor;
  const returnable = lines.filter((l) => l.isReturnable && ((quantities[l.productId] ?? 0) > 0 || (heldBy.get(l.productId) ?? 0) > 0));
  const collected = (productId: string) => (empties[productId] ?? 0) + (damaged[productId] ?? 0);
  const tooManyEmpties = returnable.some((l) => collected(l.productId) > (heldBy.get(l.productId) ?? 0) + (quantities[l.productId] ?? 0));

  const submit = () => {
    setLocalError(null);
    if (totalCans === 0) return setLocalError('Enter how many cans were delivered.');
    const missing = unpriced.find((l) => !newPriceValid(l.productId));
    if (missing) return setLocalError(`Enter this client's price for ${missing.name}.`);
    if (payMode === 'other' && !otherValid) return setLocalError('Enter the amount received.');
    onSubmit(
      {
        items: lines
          .filter((l) => (quantities[l.productId] ?? 0) > 0 || collected(l.productId) > 0)
          .map((l) => ({
            productId: l.productId,
            quantity: quantities[l.productId] ?? 0,
            emptyCollected: empties[l.productId] ?? 0,
            damagedCollected: damaged[l.productId] ?? 0,
            ...(l.unitPrice === null && (quantities[l.productId] ?? 0) > 0 ? { unitPrice: newPrices[l.productId] } : {}),
          })),
        payment: { amount: fromMinor(paidMinor), method },
      },
      {
        total: fromMinor(totalMinor),
        paid: fromMinor(paidMinor),
        cans: totalCans,
        empties: Object.values(empties).reduce((a, b) => a + b, 0),
        damaged: Object.values(damaged).reduce((a, b) => a + b, 0),
      },
    );
  };
  const shownError = localError ?? error;

  return (
    <>
      <PageHeader
        title={title ?? store.name}
        subtitle={
          <>
            <BalanceText balance={store.balance} format={format} className="font-medium" />
            {store.cansOutstanding ? ` · ${store.cansOutstanding} cans with client` : ''}
          </>
        }
        back={back}
        action={headerAction}
      />
      <div className="flex flex-col gap-5 px-safe pt-4 pb-40">
        {top}
        <section>
          <SectionTitle>Delivered</SectionTitle>
          <Card className="flex flex-col gap-4 p-4">
            {lines.map((l) => (
              <div key={l.productId} className="flex flex-col gap-2">
                <QuantityStepper
                  label={l.name}
                  hint={[l.unitPrice !== null ? `${format(l.unitPrice)} each` : 'No price for this client yet', l.note].filter(Boolean).join(' · ')}
                  value={quantities[l.productId] ?? 0}
                  onChange={(v) => setQuantities((q) => ({ ...q, [l.productId]: v }))}
                />
                {l.unitPrice === null && (quantities[l.productId] ?? 0) > 0 ? (
                  <MoneyField
                    label={`Price per ${l.name} for this client`}
                    hint="Saved for this client, so you only enter it once."
                    value={newPrices[l.productId] ?? ''}
                    onChange={(e) => setNewPrices((p) => ({ ...p, [l.productId]: sanitizeMoneyInput(e.target.value) }))}
                  />
                ) : null}
              </div>
            ))}
          </Card>
        </section>

        {returnable.length > 0 ? (
          <section>
            <SectionTitle>Empty cans collected</SectionTitle>
            <Card className="flex flex-col gap-4 p-4">
              {returnable.map((l) => {
                const delivered = quantities[l.productId] ?? 0;
                const held = heldBy.get(l.productId) ?? 0;
                return (
                  <div key={l.productId} className="flex flex-col gap-2">
                    <QuantityStepper
                      label={l.name}
                      hint={`Client has ${held} can${held === 1 ? '' : 's'}`}
                      value={empties[l.productId] ?? 0}
                      onChange={(v) => setEmpties((e) => ({ ...e, [l.productId]: v }))}
                    />
                    {delivered > 0 && (empties[l.productId] ?? 0) !== delivered ? (
                      <button
                        type="button"
                        onClick={() => setEmpties((e) => ({ ...e, [l.productId]: delivered }))}
                        className="h-9 self-start rounded-full border border-line-strong px-3 text-sm font-medium text-brand-700"
                      >
                        Same as delivered ({delivered})
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {showDamaged ? (
                <div className="flex flex-col gap-4 border-t border-line pt-4">
                  <p className="text-[15px] font-semibold text-ink">Damaged cans taken back</p>
                  {returnable.map((l) => (
                    <QuantityStepper
                      key={l.productId}
                      label={`Damaged ${l.name}`}
                      hint="Not charged · goes to Damaged stock"
                      value={damaged[l.productId] ?? 0}
                      onChange={(v) => setDamaged((d) => ({ ...d, [l.productId]: v }))}
                    />
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDamaged(true)}
                  className="-mb-1 flex h-11 items-center gap-1.5 self-start text-[15px] font-semibold text-brand-700"
                >
                  <TriangleAlert className="size-4" aria-hidden />
                  Some cans came back damaged
                </button>
              )}
              {tooManyEmpties ? (
                <p className="flex items-center gap-1.5 text-sm text-warn">
                  <CircleAlert className="size-4 shrink-0" aria-hidden />
                  More cans back than recorded at this client. Check the count, or correct the client's cans on their page if they had cans you never entered.
                </p>
              ) : null}
            </Card>
          </section>
        ) : null}

        <section>
          <SectionTitle>Payment</SectionTitle>
          <Card className="flex flex-col gap-4 p-4">
            <Segmented<PayMode>
              label="Payment"
              size="lg"
              value={payMode}
              onChange={setPayMode}
              options={[
                { value: 'full', label: 'Paid full' },
                { value: 'other', label: 'Part paid' },
                { value: 'credit', label: 'Credit' },
              ]}
            />
            {payMode === 'other' ? (
              <MoneyField
                label="Amount received"
                value={otherAmount}
                autoFocus
                onChange={(e) => setOtherAmount(sanitizeMoneyInput(e.target.value))}
                hint="Paying more than the bill also clears older dues."
              />
            ) : null}
            {payMode !== 'credit' ? (
              <Segmented<PaymentMethod> label="Payment method" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} />
            ) : null}
          </Card>
        </section>

        <Card className="p-4">
          <dl className="space-y-1.5 text-[15px]">
            <SummaryRow label={`Total · ${totalCans} can${totalCans === 1 ? '' : 's'}`} value={format(fromMinor(totalMinor))} strong />
            <SummaryRow label="Received now" value={format(fromMinor(paidMinor))} />
            {totalMinor - paidMinor > 0 ? <SummaryRow label="Added to credit" value={format(fromMinor(totalMinor - paidMinor))} tone="bad" /> : null}
            <div className="my-2 border-t border-line" />
            <SummaryRow label="Client balance after" value={<BalanceText balance={fromMinor(newBalanceMinor)} format={format} />} />
          </dl>
          {overLimit ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-warn">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Over this client's credit limit of {format(store.creditLimit ?? '0')}.
            </p>
          ) : null}
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-safe pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="mx-auto max-w-xl">
          {shownError ? (
            <p role="alert" className="mb-2 flex items-center gap-1.5 text-sm text-bad">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {shownError}
            </p>
          ) : null}
          <Button size="lg" block loading={pending} onClick={submit} disabled={totalCans === 0}>
            Confirm delivery · {format(fromMinor(totalMinor))}
          </Button>
        </div>
      </div>
    </>
  );
}

export function SummaryRow({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: 'bad' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular ${strong ? 'text-lg font-semibold text-ink' : tone === 'bad' ? 'font-medium text-bad' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}

/** Shown when a delivery was saved on the phone because there was no connection. */
export function DeliveryQueued({
  storeName,
  totals,
  primary,
  secondary,
}: {
  storeName: string;
  totals: DeliveryTotals;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  const format = useMoney();
  return (
    <>
      <PageHeader title="Saved on this phone" />
      <PageBody>
        <Card className="flex flex-col items-center px-5 py-7 text-center">
          <CloudOff className="size-12 text-brand-700" aria-hidden />
          <p className="mt-3 text-lg font-semibold text-ink">{storeName}</p>
          <p className="mt-1 text-[15px] text-muted">
            You're offline. This delivery is saved and will be sent automatically when you're back online.
          </p>
          <dl className="mt-5 w-full space-y-1.5 text-left text-[15px]">
            <SummaryRow label={`Total · ${totals.cans} can${totals.cans === 1 ? '' : 's'}`} value={format(totals.total)} strong />
            <SummaryRow label="Paid" value={format(totals.paid)} />
            {totals.empties ? <SummaryRow label="Empties collected" value={String(totals.empties)} /> : null}
            {totals.damaged ? <SummaryRow label="Damaged cans taken back" value={String(totals.damaged)} /> : null}
          </dl>
          <p className="mt-4 text-sm text-muted">The order number and new balance appear after it syncs.</p>
        </Card>
        <div className={secondary ? 'grid grid-cols-2 gap-3' : ''}>
          {secondary ? (
            <Button variant="secondary" size="lg" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
          <Button size="lg" block onClick={primary.onClick}>
            {primary.label}
          </Button>
        </div>
      </PageBody>
    </>
  );
}

interface DeliveryDoneProps {
  result: QuickSaleResult;
  store: { name: string; phone: string | null };
  primary: { label: string; onClick: () => void };
  secondary: { label: string; onClick: () => void };
}

/** Confirmation after a delivery, with an optional WhatsApp receipt for the store. */
export function DeliveryDone({ result, store, primary, secondary }: DeliveryDoneProps) {
  const format = useMoney();
  const { order } = result;
  const lines = order.items.map((i) => `${i.delivered} × ${i.productName}`).join(', ');
  const empties = order.items.reduce((s, i) => s + i.emptyCollected, 0);
  const damaged = order.items.reduce((s, i) => s + i.damagedCollected, 0);
  const receipt = [
    `Order #${order.orderNumber} delivered`,
    lines,
    empties ? `Empty cans collected: ${empties}` : null,
    damaged ? `Damaged cans taken back: ${damaged}` : null,
    `Total: ${format(order.total)}`,
    `Paid: ${format(order.amountPaid)}`,
    `Balance due: ${format(result.storeBalance)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const waPhone = store.phone?.replace(/\D/g, '');

  return (
    <>
      <PageHeader title={order.status === 'PARTIALLY_DELIVERED' ? 'Partly delivered' : 'Delivered'} />
      <PageBody>
        <Card className="flex flex-col items-center px-5 py-7 text-center">
          <CircleCheck className="size-12 text-ok" aria-hidden />
          <p className="mt-3 text-lg font-semibold text-ink">
            Order #{order.orderNumber} · {store.name}
          </p>
          <p className="mt-1 text-[15px] text-muted">{lines}</p>
          <dl className="mt-5 w-full space-y-1.5 text-left text-[15px]">
            <SummaryRow label="Total" value={format(order.total)} strong />
            <SummaryRow label="Paid" value={format(order.amountPaid)} />
            {empties ? <SummaryRow label="Empties collected" value={String(empties)} /> : null}
            {damaged ? <SummaryRow label="Damaged cans taken back" value={String(damaged)} /> : null}
            <div className="my-2 border-t border-line" />
            <SummaryRow label="Client balance" value={<BalanceText balance={result.storeBalance} format={format} />} />
          </dl>
          {order.stockWarning ? (
            <p className="mt-4 flex items-center gap-1.5 text-left text-sm text-warn">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Stock numbers went below zero. Check your inventory count.
            </p>
          ) : null}
        </Card>
        {waPhone ? (
          <a
            href={`https://wa.me/${waPhone}?text=${encodeURIComponent(receipt)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface font-semibold text-ink"
          >
            <MessageCircle className="size-5" aria-hidden />
            Send receipt on WhatsApp
          </a>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
          <Button size="lg" onClick={primary.onClick}>
            {primary.label}
          </Button>
        </div>
      </PageBody>
    </>
  );
}
