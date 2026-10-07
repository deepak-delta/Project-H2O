import { fromMinor, isMoneyString, lineTotalMinor, toMinor, zonedDateKey, type ProductDto, type StoreDetail } from '@wd/shared';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Segmented } from '../../components/ui/Segmented';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { useStaffList } from '../staff/api';
import { usePlaceOrder } from './api';

type When = 'today' | 'tomorrow';

/**
 * Owner: an order to be delivered later, optionally given to a member of staff (who is
 * notified and sees it under "To deliver"). Nothing is billed until it is delivered.
 */
export function ScheduleOrderForm({
  store,
  products,
  headerAction,
  top,
  onNewOrder,
}: {
  store: StoreDetail;
  products: ProductDto[];
  headerAction: ReactNode;
  top: ReactNode;
  onNewOrder: () => void;
}) {
  const format = useMoney();
  const tz = useTimezone();
  const navigate = useNavigate();
  const place = usePlaceOrder();
  const staff = useStaffList();
  const activeStaff = staff.data?.filter((s) => s.active) ?? [];
  const [clientId] = useState(() => crypto.randomUUID());
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, store.lastOrderItems.find((i) => i.productId === p.id)?.quantity ?? 0])),
  );
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const [when, setWhen] = useState<When>('today');
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: string | null; orderNumber: number | null } | null>(null);

  const priceOf = (productId: string) => store.prices.find((x) => x.productId === productId)?.price ?? null;
  const validNew = (productId: string) => isMoneyString(newPrices[productId] ?? '') && toMinor(newPrices[productId] ?? '0') > 0;
  const totalCans = Object.values(quantities).reduce((a, b) => a + b, 0);
  const estimate = products.reduce((sum, p) => {
    const price = priceOf(p.id) ?? (validNew(p.id) ? newPrices[p.id] : null);
    return sum + (price ? lineTotalMinor(toMinor(price), quantities[p.id] ?? 0) : 0);
  }, 0);
  const staffName = activeStaff.find((s) => s.id === assignee)?.name ?? null;

  if (placed) {
    return (
      <>
        <PageHeader title="Order created" />
        <PageBody>
          <Card className="flex flex-col items-center px-5 py-8 text-center">
            <CircleCheck className="size-12 text-ok" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-ink">
              {placed.id ? `Order #${placed.orderNumber} · ${store.name}` : 'Order saved on this phone'}
            </p>
            <p className="mt-1 text-[15px] text-muted">
              {totalCans} can{totalCans === 1 ? '' : 's'} for {when}.{' '}
              {staffName ? `Given to ${staffName}, who has been notified.` : "You'll deliver it."}
              {placed.id ? '' : " It will be sent when you're back online."}
            </p>
          </Card>
          <div className={placed.id ? 'grid grid-cols-2 gap-3' : ''}>
            {placed.id ? (
              <Button variant="secondary" size="lg" onClick={() => void navigate(`/orders/${placed.id}`, { replace: true })}>
                View order
              </Button>
            ) : null}
            <Button size="lg" block onClick={onNewOrder}>
              New order
            </Button>
          </div>
        </PageBody>
      </>
    );
  }

  const submit = () => {
    setError(null);
    if (totalCans === 0) return setError('Choose how many cans.');
    const unpriced = products.find((p) => (quantities[p.id] ?? 0) > 0 && priceOf(p.id) === null && !validNew(p.id));
    if (unpriced) return setError(`Enter this client's price for ${unpriced.name}.`);
    const day = new Date();
    if (when === 'tomorrow') day.setTime(day.getTime() + 24 * 60 * 60 * 1000);
    place.mutate(
      {
        input: {
          clientId,
          storeId: store.id,
          items: products
            .filter((p) => (quantities[p.id] ?? 0) > 0)
            .map((p) => ({
              productId: p.id,
              quantity: quantities[p.id] ?? 0,
              ...(priceOf(p.id) === null ? { unitPrice: newPrices[p.id] } : {}),
            })),
          deliveryDate: zonedDateKey(day, tz),
          notes: notes.trim() || undefined,
          assignedToId: assignee || null,
        },
        summary: { title: `Order ${totalCans} can${totalCans === 1 ? '' : 's'}`, detail: store.name, storeId: store.id },
      },
      {
        onSuccess: (r) => setPlaced(r.queued ? { id: null, orderNumber: null } : { id: r.data.id, orderNumber: r.data.orderNumber }),
        onError: (err) => setError(errorMessage(err, 'The order was not saved. Check your connection and try again.')),
      },
    );
  };

  return (
    <>
      <PageHeader title={store.name} subtitle="Order for later delivery" back={true} action={headerAction} />
      <div className="flex flex-col gap-5 px-safe pt-4 pb-40">
        {top}
        <section>
          <SectionTitle>How many?</SectionTitle>
          <Card className="flex flex-col gap-4 p-4">
            {products.map((p) => {
              const price = priceOf(p.id);
              return (
                <div key={p.id} className="flex flex-col gap-2">
                  <QuantityStepper
                    label={p.name}
                    hint={price !== null ? `${format(price)} each` : 'No price for this client yet'}
                    value={quantities[p.id] ?? 0}
                    onChange={(v) => setQuantities((q) => ({ ...q, [p.id]: v }))}
                  />
                  {price === null && (quantities[p.id] ?? 0) > 0 ? (
                    <MoneyField
                      label={`Price per ${p.name} for this client`}
                      hint="Saved for this client, so you only enter it once."
                      value={newPrices[p.id] ?? ''}
                      onChange={(e) => setNewPrices((n) => ({ ...n, [p.id]: sanitizeMoneyInput(e.target.value) }))}
                    />
                  ) : null}
                </div>
              );
            })}
          </Card>
        </section>
        <section>
          <SectionTitle>When?</SectionTitle>
          <Segmented<When>
            label="Delivery day"
            size="lg"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
            ]}
          />
        </section>
        <section>
          <SectionTitle>Who delivers?</SectionTitle>
          <Card className="flex items-center justify-between gap-3 px-4 py-3">
            <label htmlFor="schedule-assignee" className="text-[15px] font-medium text-ink-2">
              Delivered by
            </label>
            <select
              id="schedule-assignee"
              className="h-11 min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-ink"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Me (owner)</option>
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Card>
          {staff.data && activeStaff.length === 0 ? (
            <p className="mt-2 px-1 text-sm text-muted">Add delivery staff under More → Delivery staff to give them orders.</p>
          ) : null}
        </section>
        <Field label="Note (optional)" placeholder="e.g. Deliver before 10am, back gate" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-sm text-muted">About {format(fromMinor(estimate))}. The bill is made when it is delivered.</p>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-safe pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="mx-auto max-w-xl">
          {error ? (
            <p role="alert" className="mb-2 flex items-center gap-1.5 text-sm text-bad">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <Button size="lg" block loading={place.isPending} disabled={totalCans === 0} onClick={submit}>
            {staffName ? `Give to ${staffName}` : 'Create order'} · {totalCans} can{totalCans === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </>
  );
}
