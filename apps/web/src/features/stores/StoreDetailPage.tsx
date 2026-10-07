import {
  formatPhone,
  toMinor,
  type LedgerType,
  type MovementType,
  type StoreDetail,
} from '@wd/shared';
import { Bell, CloudUpload, Pencil, Phone, Plus, Undo2, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry, LoadMore } from '../../components/ui/LoadMore';
import { Segmented } from '../../components/ui/Segmented';
import { ConfirmSheet } from '../../components/ui/Sheet';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { PageSpinner } from '../../components/ui/Spinner';
import { BalanceText } from '../../components/ui/Stat';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { formatDate, formatDateTime } from '../../utils/format';
import { useSendReminder, useSetStoreStatus, useStore, useStoreCans, useStoreLedger } from './api';
import { usePendingForStore } from '../../offline/engine';
import { useSession } from '../auth/session';
import { clientTypeLabel } from './clientType';
import { StoreAccessCard } from './StoreAccess';
import { CollectEmptiesSheet, RecordPaymentSheet } from './StoreSheets';

const LEDGER_LABEL: Record<LedgerType, string> = {
  SALE: 'Delivery',
  PAYMENT: 'Payment',
  CREDIT_ADJUSTMENT: 'Adjustment',
  REFUND: 'Refund',
  DISCOUNT: 'Discount',
  OPENING_BALANCE: 'Opening balance',
  REVERSAL: 'Reversal',
};

const CAN_LABEL: Partial<Record<MovementType, string>> = {
  DELIVERY: 'Delivered',
  RETURN: 'Empties returned',
  OPENING: 'Opening count',
  LOSS: 'Written off',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

export default function StoreDetailPage() {
  const { id = '' } = useParams();
  const store = useStore(id);

  if (store.isPending) return <PageSpinner />;
  if (store.isError) {
    return (
      <>
        <PageHeader title="Client" back="/stores" />
        <PageBody>
          <ErrorRetry message={errorMessage(store.error)} onRetry={() => void store.refetch()} />
        </PageBody>
      </>
    );
  }
  return <StoreLedgerView store={store.data} />;
}

function ActionButton({
  icon,
  label,
  onClick,
  to,
  href,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  to?: string;
  href?: string;
}) {
  const cls =
    'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface px-1 text-[13px] font-medium text-ink-2 hover:bg-canvas active:bg-line/50';
  const body = (
    <>
      <span className="text-brand-700">{icon}</span>
      {label}
    </>
  );
  if (to)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  if (href)
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

function StoreLedgerView({ store }: { store: StoreDetail }) {
  const format = useMoney();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'money' | 'cans'>('money');
  const [paying, setPaying] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const setStatus = useSetStoreStatus(store.id);
  const active = store.status === 'ACTIVE';
  const pending = usePendingForStore(store.id);
  // Staff get the store's balance and the actions they need on the route; no history, editing,
  // app access or reminders (those are the owner's).
  const isOwner = useSession().user.role === 'SUPPLIER';

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={
          [clientTypeLabel(store), store.ownerName, store.phone ? formatPhone(store.phone) : null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        back="/stores"
        action={
          !isOwner ? undefined : (
            <Link
              to={`/stores/${store.id}/edit`}
              aria-label="Edit client"
              className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-line/50"
            >
              <Pencil className="size-5" />
            </Link>
          )
        }
      />
      <PageBody>
        {!active ? (
          <Card className="flex items-center justify-between gap-3 border-warn/30 bg-warn-bg px-4 py-3">
            <span className="text-sm font-medium text-warn">This client is inactive.</span>
            <Button
              variant="secondary"
              onClick={() => setStatus.mutate('ACTIVE')}
              loading={setStatus.isPending}
            >
              Reactivate
            </Button>
          </Card>
        ) : null}

        {pending.length > 0 ? (
          <Link
            to="/sync"
            className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"
          >
            <CloudUpload className="size-4 shrink-0" aria-hidden />
            {pending.length} entr{pending.length === 1 ? 'y' : 'ies'} for this client{' '}
            {pending.length === 1 ? 'is' : 'are'} waiting to sync and not included below yet.
          </Link>
        ) : null}

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[13px] text-muted">Balance</p>
              <p className="mt-0.5 text-xl">
                <BalanceText balance={store.balance} format={format} />
              </p>
              {store.creditLimit ? (
                <p className="text-xs text-muted">Limit {format(store.creditLimit)}</p>
              ) : null}
            </div>
            <div>
              <p className="text-[13px] text-muted">Cans with client</p>
              <p className="mt-0.5 text-xl font-semibold text-ink tabular">
                {store.cansOutstanding}
              </p>
              {store.cans.length > 1 ? (
                <p className="truncate text-xs text-muted">
                  {store.cans.map((c) => `${c.quantity} ${c.productName}`).join(', ')}
                </p>
              ) : null}
            </div>
          </div>
          {store.lastDeliveryAt ? (
            <p className="mt-3 text-xs text-muted">
              Last delivery {formatDate(store.lastDeliveryAt)}
            </p>
          ) : null}
        </Card>

        <div className="grid grid-cols-4 gap-2">
          {active ? (
            <ActionButton
              icon={<Plus className="size-5" />}
              label="Order"
              to={`/orders/new?storeId=${store.id}`}
            />
          ) : null}
          <ActionButton
            icon={<Wallet className="size-5" />}
            label="Payment"
            onClick={() => setPaying(true)}
          />
          {store.cans.length > 0 ? (
            <ActionButton
              icon={<Undo2 className="size-5" />}
              label="Empties"
              onClick={() => setCollecting(true)}
            />
          ) : null}
          {store.phone ? (
            <ActionButton
              icon={<Phone className="size-5" />}
              label="Call"
              href={`tel:${store.phone}`}
            />
          ) : null}
        </div>

        {isOwner && store.hasLogin && toMinor(store.balance) > 0 ? (
          <ReminderButton store={store} />
        ) : null}

        {isOwner ? (
          <>
            <Segmented
              label="History"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'money', label: 'Money' },
                { value: 'cans', label: 'Cans' },
              ]}
            />
            {tab === 'money' ? (
              <MoneyHistory storeId={store.id} />
            ) : (
              <CanHistory storeId={store.id} />
            )}

            <StoreAccessCard store={store} />

            {active ? (
              <Button variant="dangerGhost" block onClick={() => setConfirmStatus(true)}>
                Deactivate client
              </Button>
            ) : null}
          </>
        ) : null}
      </PageBody>

      <RecordPaymentSheet store={store} open={paying} onClose={() => setPaying(false)} />
      <CollectEmptiesSheet store={store} open={collecting} onClose={() => setCollecting(false)} />
      <ConfirmSheet
        open={confirmStatus}
        title="Deactivate this client?"
        message="It will be hidden from lists and can't get new deliveries. Its history and balance are kept, and you can reactivate it any time."
        confirmLabel="Deactivate"
        loading={setStatus.isPending}
        onClose={() => setConfirmStatus(false)}
        onConfirm={() =>
          setStatus.mutate('INACTIVE', {
            onSuccess: () => {
              setConfirmStatus(false);
              toast.success(`${store.name} deactivated.`);
              void navigate('/stores');
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </>
  );
}

export function MoneyHistory({ storeId }: { storeId: string }) {
  const ledger = useStoreLedger(storeId);
  const format = useMoney();
  const tz = useTimezone();
  const rows = ledger.data?.pages.flatMap((p) => p.items) ?? [];

  if (ledger.isPending) return <ListSkeleton rows={4} />;
  if (ledger.isError)
    return (
      <ErrorRetry message={errorMessage(ledger.error)} onRetry={() => void ledger.refetch()} />
    );
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="size-6" />}
        title="No transactions yet"
        description="Deliveries and payments will show here."
      />
    );
  }

  return (
    <>
      <ListCard>
        {rows.map((r) => {
          const credit = r.amount.startsWith('-');
          return (
            <ListRow
              key={r.id}
              to={r.orderId ? `/orders/${r.orderId}` : undefined}
              title={
                <>
                  {LEDGER_LABEL[r.type]}
                  {r.orderNumber
                    ? r.type === 'SALE'
                      ? ` #${r.orderNumber}`
                      : ` · order #${r.orderNumber}`
                    : ''}
                  {r.paymentMethod ? (
                    <span className="font-normal text-muted">
                      {' '}
                      ·{' '}
                      {r.paymentMethod === 'BANK_TRANSFER' ? 'Bank' : r.paymentMethod.toLowerCase()}
                    </span>
                  ) : null}
                </>
              }
              subtitle={`${formatDateTime(r.occurredAt, tz)} · balance ${format(r.balanceAfter)}`}
              trailing={
                <span className={`font-semibold tabular ${credit ? 'text-ok' : 'text-ink'}`}>
                  {credit ? '−' : '+'}
                  {format(r.amount.replace('-', ''))}
                </span>
              }
            />
          );
        })}
      </ListCard>
      <LoadMore
        hasMore={Boolean(ledger.hasNextPage)}
        loading={ledger.isFetchingNextPage}
        onLoad={() => void ledger.fetchNextPage()}
      />
    </>
  );
}

export function CanHistory({ storeId }: { storeId: string }) {
  const cans = useStoreCans(storeId);
  const tz = useTimezone();
  const rows = cans.data?.pages.flatMap((p) => p.items) ?? [];

  if (cans.isPending) return <ListSkeleton rows={4} />;
  if (cans.isError)
    return <ErrorRetry message={errorMessage(cans.error)} onRetry={() => void cans.refetch()} />;
  if (rows.length === 0) {
    return <EmptyState icon={<Undo2 className="size-6" />} title="No can movements yet" />;
  }
  return (
    <>
      <ListCard>
        {rows.map((m) => (
          <ListRow
            key={m.id}
            title={
              <>
                {CAN_LABEL[m.type] ?? m.type}
                {m.orderNumber ? ` #${m.orderNumber}` : ''}
              </>
            }
            subtitle={`${m.productName} · ${formatDateTime(m.occurredAt, tz)}`}
            trailing={
              <Badge tone={m.change > 0 ? 'brand' : 'ok'}>
                {m.change > 0 ? '+' : '−'}
                {Math.abs(m.change)} can{Math.abs(m.change) === 1 ? '' : 's'}
              </Badge>
            }
          />
        ))}
      </ListCard>
      <LoadMore
        hasMore={Boolean(cans.hasNextPage)}
        loading={cans.isFetchingNextPage}
        onLoad={() => void cans.fetchNextPage()}
      />
    </>
  );
}

function ReminderButton({ store }: { store: StoreDetail }) {
  const remind = useSendReminder(store.id);
  const format = useMoney();
  return (
    <Button
      variant="secondary"
      block
      icon={<Bell className="size-5" />}
      loading={remind.isPending}
      onClick={() =>
        remind.mutate(undefined, {
          onSuccess: ({ sent }) =>
            sent > 0
              ? toast.success(`Reminder for ${format(store.balance)} sent to ${store.name}.`)
              : toast.info(
                  `${store.name} hasn't turned on notifications. Try calling or WhatsApp.`,
                ),
          onError: (err) => toast.error(errorMessage(err)),
        })
      }
    >
      Send payment reminder
    </Button>
  );
}
