import type { OrderDto, QuickSaleResult, StoreDetail } from '@wd/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PageSpinner } from '../../components/ui/Spinner';
import { errorMessage } from '../../services/api';
import { useProducts } from '../catalog/api';
import { useStore } from '../stores/api';
import { Destination } from '../stores/Destination';
import { useDeliverOrder, useOrder } from './api';
import { DeliveryDone, DeliveryForm, DeliveryQueued, type DeliveryTotals } from './DeliveryForm';

/** Deliver an order placed earlier, prefilled with what is still to be delivered. */
export default function DeliverOrderPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);
  const store = useStore(order.data?.storeId);

  if (order.isPending || (order.isSuccess && store.isPending)) return <PageSpinner />;
  if (order.isError || store.isError) {
    return (
      <>
        <PageHeader title="Deliver order" back={true} />
        <PageBody>
          <ErrorRetry
            message={errorMessage(order.error ?? store.error)}
            onRetry={() => {
              void order.refetch();
              void store.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }
  if (!store.data) return <PageSpinner />;
  return <DeliverForm order={order.data} store={store.data} />;
}

function DeliverForm({ order, store }: { order: OrderDto; store: StoreDetail }) {
  const navigate = useNavigate();
  const deliver = useDeliverOrder(order.id);
  const products = useProducts({ all: true });
  const [clientId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<QuickSaleResult | null>(null);
  const [queued, setQueued] = useState<DeliveryTotals | null>(null);
  const returnable = new Set(products.data?.filter((p) => p.isReturnable).map((p) => p.id) ?? []);

  if (queued) {
    return (
      <DeliveryQueued
        storeName={store.name}
        totals={queued}
        primary={{ label: 'Done', onClick: () => void navigate('/orders?tab=open', { replace: true }) }}
      />
    );
  }
  if (done) {
    return (
      <DeliveryDone
        result={done}
        store={store}
        primary={{ label: 'Done', onClick: () => void navigate(`/orders/${order.id}`, { replace: true }) }}
        secondary={{ label: 'Pending orders', onClick: () => void navigate('/orders?tab=open', { replace: true }) }}
      />
    );
  }
  if (products.isPending) return <PageSpinner />;

  return (
    <DeliveryForm
      store={store}
      title={`Deliver #${order.orderNumber} · ${store.name}`}
      back={true}
      top={<Destination address={store.address ?? order.storeAddress} mapLink={store.mapLink ?? order.storeMapLink} />}
      askWhenShort
      lines={order.items.map((i) => ({
        productId: i.productId,
        name: i.productName,
        unitPrice: i.unitPrice,
        isReturnable: returnable.has(i.productId),
        initialQty: Math.max(i.quantity - i.delivered, 0),
        note: i.delivered > 0 ? `ordered ${i.quantity}, ${i.delivered} delivered` : `ordered ${i.quantity}`,
      }))}
      pending={deliver.isPending}
      error={deliver.error ? errorMessage(deliver.error, 'The delivery was not saved. Check your connection and try again.') : null}
      onSubmit={(values, totals) =>
        deliver.mutate(
          {
            input: { clientId, ...values },
            summary: { title: `Order #${order.orderNumber} delivered`, detail: store.name, storeId: store.id },
          },
          { onSuccess: (r) => (r.queued ? setQueued(totals) : setDone(r.data)) },
        )
      }
    />
  );
}
