import { fromMinor, lineTotalMinor, toMinor, zonedDateKey } from '@wd/shared';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Segmented } from '../../components/ui/Segmented';
import { PageSpinner } from '../../components/ui/Spinner';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { useProducts } from '../catalog/api';
import { usePlaceOrder } from '../orders/api';
import { useStoreHome } from './api';

type When = 'today' | 'tomorrow';

/** Store owner: how many cans, when, confirm. Prefilled with the last delivery. */
export default function OrderWaterPage() {
  const products = useProducts();
  const home = useStoreHome();

  if (products.isPending || home.isPending) return <PageSpinner />;
  if (products.isError || home.isError) {
    return (
      <>
        <PageHeader title="Order water" back="/" />
        <PageBody>
          <ErrorRetry
            message={errorMessage(products.error ?? home.error)}
            onRetry={() => {
              void products.refetch();
              void home.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }
  // Each store orders at its own price; a product without one can't be ordered yet.
  const priced = products.data.map((p) => ({ id: p.id, name: p.name, price: home.data.prices.find((x) => x.productId === p.id)?.price ?? null }));
  const firstPriced = priced.findIndex((p) => p.price !== null);
  const initial = Object.fromEntries(
    priced.map((p, index) => [
      p.id,
      p.price === null
        ? 0
        : (home.data.lastOrderItems.find((i) => i.productId === p.id)?.quantity ?? (home.data.lastOrderItems.length === 0 && index === firstPriced ? 1 : 0)),
    ]),
  );
  return <OrderWaterForm products={priced} supplierName={home.data.supplier.businessName} initial={initial} />;
}

function OrderWaterForm({
  products,
  supplierName,
  initial,
}: {
  products: { id: string; name: string; price: string | null }[];
  supplierName: string;
  initial: Record<string, number>;
}) {
  const format = useMoney();
  const tz = useTimezone();
  const navigate = useNavigate();
  const place = usePlaceOrder();
  const [clientId] = useState(() => crypto.randomUUID());
  const [quantities, setQuantities] = useState(initial);
  const [when, setWhen] = useState<When>('today');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  // `null` id = saved on the phone, waiting for a connection.
  const [placed, setPlaced] = useState<{ id: string | null; orderNumber: number | null } | null>(null);

  const totalCans = Object.values(quantities).reduce((a, b) => a + b, 0);
  const estimate = products.reduce((s, p) => s + (p.price === null ? 0 : lineTotalMinor(toMinor(p.price), quantities[p.id] ?? 0)), 0);

  if (placed) {
    return (
      <>
        <PageHeader title="Order placed" />
        <PageBody>
          <Card className="flex flex-col items-center px-5 py-8 text-center">
            <CircleCheck className="size-12 text-ok" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-ink">
              {placed.id ? `Order #${placed.orderNumber} sent` : 'Order saved on this phone'}
            </p>
            <p className="mt-1 text-[15px] text-muted">
              {totalCans} can{totalCans === 1 ? '' : 's'} for {when}.{' '}
              {placed.id
                ? "It's now in your supplier's order list."
                : "You're offline, so it will be sent automatically as soon as you're back online."}
            </p>
          </Card>
          <div className={placed.id ? 'grid grid-cols-2 gap-3' : ''}>
            {placed.id ? (
              <Button variant="secondary" size="lg" onClick={() => void navigate(`/orders/${placed.id}`, { replace: true })}>
                View order
              </Button>
            ) : null}
            <Button size="lg" block onClick={() => void navigate('/', { replace: true })}>
              Done
            </Button>
          </div>
        </PageBody>
      </>
    );
  }

  const submit = () => {
    setError(null);
    if (totalCans === 0) return setError('Choose how many cans you need.');
    const day = new Date();
    if (when === 'tomorrow') day.setTime(day.getTime() + 24 * 60 * 60 * 1000);
    place.mutate(
      {
        input: {
          clientId,
          items: products.filter((p) => (quantities[p.id] ?? 0) > 0).map((p) => ({ productId: p.id, quantity: quantities[p.id] ?? 0 })),
          deliveryDate: zonedDateKey(day, tz),
          notes: notes.trim() || undefined,
        },
        summary: { title: `Order ${totalCans} can${totalCans === 1 ? '' : 's'}`, detail: `For ${when}`, storeId: null },
      },
      {
        onSuccess: (r) =>
          setPlaced(r.queued ? { id: null, orderNumber: null } : { id: r.data.id, orderNumber: r.data.orderNumber }),
        onError: (err) => setError(errorMessage(err, 'Your order was not sent. Check your connection and try again.')),
      },
    );
  };

  return (
    <>
      <PageHeader title="Order water" back="/" />
      <div className="flex flex-col gap-5 px-safe pt-4 pb-40">
        <section>
          <SectionTitle>How many?</SectionTitle>
          <Card className="flex flex-col gap-4 p-4">
            {products.map((p) =>
              p.price !== null ? (
                <QuantityStepper
                  key={p.id}
                  label={p.name}
                  hint={`${format(p.price)} each`}
                  value={quantities[p.id] ?? 0}
                  onChange={(v) => setQuantities((q) => ({ ...q, [p.id]: v }))}
                />
              ) : (
                <div key={p.id}>
                  <p className="font-medium text-ink">{p.name}</p>
                  <p className="text-sm text-muted">Not available yet: ask {supplierName} to set your price.</p>
                </div>
              ),
            )}
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
        <Field label="Note for the supplier (optional)" placeholder="e.g. Deliver before 10am" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-sm text-muted">
          About {format(fromMinor(estimate))}. You pay for what is delivered.
        </p>
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
            Send order · {totalCans} can{totalCans === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </>
  );
}
