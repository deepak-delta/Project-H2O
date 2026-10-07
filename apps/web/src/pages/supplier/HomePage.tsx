import type { ProductDto } from '@wd/shared';
import { CircleCheck, Store, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, SectionTitle } from '../../components/ui/Card';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Skeleton } from '../../components/ui/Skeleton';
import { Stat } from '../../components/ui/Stat';
import { useSession } from '../../features/auth/session';
import { useProducts } from '../../features/catalog/api';
import { ProductForm } from '../../features/catalog/ProductsPage';
import { useDashboard, useStockMovement } from '../../features/inventory/api';
import { useStores } from '../../features/stores/api';
import { useMoney } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';

export default function SupplierHomePage() {
  const { business, user } = useSession();
  const products = useProducts({ all: true });
  const stores = useStores({});
  const [newProduct, setNewProduct] = useState<ProductDto | null>(null);

  const noProducts = products.data?.length === 0;
  const noStores = stores.data?.pages[0]?.items.length === 0;
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: business.timezone }).format(
    new Date(),
  );

  return (
    <>
      <PageHeader title={business.businessName} subtitle={`${today} · Hi ${user.name.split(' ')[0]}`} />
      <PageBody>
        {newProduct ? (
          <OpeningStockCard product={newProduct} onDone={() => setNewProduct(null)} />
        ) : noProducts ? (
          <Card className="p-4">
            <p className="text-lg font-semibold text-ink">Let's set up your business</p>
            <p className="mb-4 text-sm text-muted">Step 1 of 3: what do you deliver? You'll set each store's price when you add it.</p>
            <ProductForm onDone={setNewProduct} />
          </Card>
        ) : noStores ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Store className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-semibold text-ink">Add your first store</p>
              <p className="text-sm text-muted">Add the shops you deliver to. You can bring over what they owe from your notebook.</p>
            </div>
            <Link to="/stores/new" className="inline-flex h-11 items-center rounded-xl bg-brand-700 px-4 font-semibold text-white">
              Add store
            </Link>
          </Card>
        ) : null}

        {!noProducts ? <Dashboard /> : null}
      </PageBody>
    </>
  );
}

function OpeningStockCard({ product, onDone }: { product: ProductDto; onDone: () => void }) {
  const [filled, setFilled] = useState(0);
  const [empty, setEmpty] = useState(0);
  const [clientId] = useState(() => crypto.randomUUID());
  const move = useStockMovement();

  const save = () =>
    move.mutate(
      { kind: 'OPENING', clientId, productId: product.id, filled, empty },
      {
        onSuccess: () => {
          toast.success('Stock saved.');
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <p className="flex items-center gap-2 text-lg font-semibold text-ink">
          <CircleCheck className="size-5 text-ok" aria-hidden /> {product.name} added
        </p>
        <p className="text-sm text-muted">Step 2 of 3: how many cans do you have right now?</p>
      </div>
      <QuantityStepper label="Filled cans" value={filled} onChange={setFilled} />
      {product.isReturnable ? <QuantityStepper label="Empty cans" value={empty} onChange={setEmpty} /> : null}
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <Button variant="secondary" size="lg" onClick={onDone} disabled={move.isPending}>
          Skip
        </Button>
        <Button size="lg" loading={move.isPending} disabled={filled + empty === 0} onClick={save}>
          Save stock
        </Button>
      </div>
    </Card>
  );
}

function Dashboard() {
  const dashboard = useDashboard();
  const format = useMoney();

  if (dashboard.isPending) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (dashboard.isError) return <ErrorRetry message={errorMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />;

  const { today, money, inventory, stockWarnings } = dashboard.data;
  return (
    <>
      {inventory.lowStock || stockWarnings > 0 ? (
        <Link to="/inventory" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          {stockWarnings > 0
            ? `${stockWarnings} deliver${stockWarnings === 1 ? 'y' : 'ies'} today went past your stock. Check the count.`
            : `Only ${inventory.filled} filled cans left.`}
        </Link>
      ) : null}

      <section>
        <SectionTitle>Today</SectionTitle>
        <Card className="grid grid-cols-2 gap-2 p-2">
          <Stat label="Orders" value={today.orders} to="/orders?tab=today" />
          <Stat label="Pending" value={today.pending} tone={today.pending > 0 ? 'warn' : 'default'} to="/orders?tab=open" />
          <Stat label="Sales" value={format(today.sales)} />
          <Stat label="Cans delivered" value={today.cansDelivered} hint={`${today.emptiesCollected} empties back`} />
        </Card>
      </section>

      <section>
        <SectionTitle>Money</SectionTitle>
        <Card className="grid grid-cols-2 gap-2 p-2">
          <Stat label="Collected today" value={format(today.cashCollected)} to="/payments" />
          <Stat label="Credit given today" value={format(today.creditGiven)} />
          <Stat label="Expenses today" value={format(today.expenses)} to="/cashflow" />
          <Stat label="Net cash today" value={format(today.netCash)} tone={today.netCash.startsWith('-') ? 'bad' : 'default'} to="/cashflow" />
          <div className="col-span-2">
            <Stat
              label="Outstanding with stores"
              value={format(money.outstanding)}
              hint={`${money.storesOwing} ${money.storesOwing === 1 ? 'store owes' : 'stores owe'} money`}
              tone={money.storesOwing > 0 ? 'bad' : 'default'}
              to="/stores?filter=owes"
            />
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Cans</SectionTitle>
        <Card className="grid grid-cols-3 gap-2 p-2">
          <Stat label="Filled" value={inventory.filled} tone={inventory.lowStock ? 'warn' : 'default'} to="/inventory" />
          <Stat label="Empty" value={inventory.empty} to="/inventory" />
          <Stat label="With stores" value={inventory.withCustomers} to="/inventory/holders" />
        </Card>
      </section>
    </>
  );
}
