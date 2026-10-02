import type { ProductDto, QuickSaleResult, StoreDetail } from '@wd/shared';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PageSpinner } from '../../components/ui/Spinner';
import { errorMessage } from '../../services/api';
import { useProducts } from '../catalog/api';
import { StorePicker } from '../stores/StorePicker';
import { useQueryClient } from '@tanstack/react-query';
import { useOnline } from '../../hooks/useOnline';
import { cachedStores, storeDetailFromListItem, useStore } from '../stores/api';
import { useQuickSale } from './api';
import { DeliveryDone, DeliveryForm, DeliveryQueued, type DeliveryTotals } from './DeliveryForm';

/** Supplier quick sale: store → quantities → empties → payment → confirm. */
export default function NewOrderPage() {
  const [params, setParams] = useSearchParams();
  const storeId = params.get('storeId');

  if (!storeId) {
    return (
      <>
        <PageHeader title="New order" subtitle="Choose a store" back={true} />
        <PageBody>
          <StorePicker onPick={(id) => setParams({ storeId: id })} />
        </PageBody>
      </>
    );
  }
  return <QuickSale key={storeId} storeId={storeId} onChangeStore={() => setParams({})} />;
}

function QuickSale({ storeId, onChangeStore }: { storeId: string; onChangeStore: () => void }) {
  const store = useStore(storeId);
  const products = useProducts();
  const online = useOnline();
  const queryClient = useQueryClient();

  // Offline and this store's page was never opened: its saved list row is enough to sell.
  if (!online && !store.data && products.data) {
    const row = cachedStores(queryClient).find((s) => s.id === storeId);
    if (row) return <QuickSaleForm store={storeDetailFromListItem(row)} products={products.data} onChangeStore={onChangeStore} />;
  }
  if (store.isPending || products.isPending) return <PageSpinner />;
  if (store.isError || products.isError) {
    return (
      <>
        <PageHeader title="New order" back={true} />
        <PageBody>
          <ErrorRetry
            message={errorMessage(store.error ?? products.error)}
            onRetry={() => {
              void store.refetch();
              void products.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }
  if (products.data.length === 0) {
    return (
      <>
        <PageHeader title="New order" back={true} />
        <PageBody>
          <EmptyState
            icon={<CircleAlert className="size-6" />}
            title="Add a product first"
            description="Set up what you sell (e.g. 20L can) and its price."
            action={
              <Link to="/products" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
                Add product
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }
  return <QuickSaleForm store={store.data} products={products.data} onChangeStore={onChangeStore} />;
}

function QuickSaleForm({ store, products, onChangeStore }: { store: StoreDetail; products: ProductDto[]; onChangeStore: () => void }) {
  const navigate = useNavigate();
  const sale = useQuickSale();
  // One idempotency key per order: retrying after a network error can't double-record.
  const [clientId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<QuickSaleResult | null>(null);
  const [queued, setQueued] = useState<DeliveryTotals | null>(null);

  if (queued) {
    return (
      <DeliveryQueued
        storeName={store.name}
        totals={queued}
        primary={{ label: 'New order', onClick: onChangeStore }}
        secondary={{ label: 'Home', onClick: () => void navigate('/', { replace: true }) }}
      />
    );
  }
  if (done) {
    return (
      <DeliveryDone
        result={done}
        store={store}
        primary={{ label: 'New order', onClick: onChangeStore }}
        secondary={{ label: 'View store', onClick: () => void navigate(`/stores/${store.id}`, { replace: true }) }}
      />
    );
  }

  return (
    <DeliveryForm
      store={store}
      back={true}
      headerAction={
        <Button variant="ghost" onClick={onChangeStore}>
          Change
        </Button>
      }
      lines={products.map((p) => ({
        productId: p.id,
        name: p.name,
        unitPrice: p.sellingPrice,
        isReturnable: p.isReturnable,
        initialQty: store.lastOrderItems.find((i) => i.productId === p.id)?.quantity ?? 0,
      }))}
      pending={sale.isPending}
      error={sale.error ? errorMessage(sale.error, 'The order was not saved. Check your connection and try again.') : null}
      onSubmit={(values, totals) =>
        sale.mutate(
          {
            input: { clientId, storeId: store.id, ...values },
            summary: { title: `${totals.cans} can${totals.cans === 1 ? '' : 's'} delivered`, detail: store.name, storeId: store.id },
          },
          { onSuccess: (r) => (r.queued ? setQueued(totals) : setDone(r.data)) },
        )
      }
    />
  );
}
