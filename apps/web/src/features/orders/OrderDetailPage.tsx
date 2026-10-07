import { fromMinor, lineTotalMinor, toMinor, type OrderDto, type OrderPaymentDto } from '@wd/shared';
import { CalendarDays, CircleAlert, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge, OrderStatusBadge, PaymentBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, ListCard, ListRow, SectionTitle } from '../../components/ui/Card';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PageSpinner } from '../../components/ui/Spinner';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { formatDate, formatDateTime } from '../../utils/format';
import { useSession } from '../auth/session';
import { useAssignOrder, useStaffList } from '../staff/api';
import { useOrder, useOrderStatus } from './api';
import { SummaryRow } from './DeliveryForm';
import { CancelOrderSheet, ReversePaymentSheet } from './OrderSheets';

const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', OTHER: 'Other' } as const;
const OPEN = ['PENDING', 'CONFIRMED', 'OUT_FOR_DELIVERY'];

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);

  if (order.isPending) return <PageSpinner />;
  if (order.isError) {
    return (
      <>
        <PageHeader title="Order" back={true} />
        <PageBody>
          <ErrorRetry message={errorMessage(order.error)} onRetry={() => void order.refetch()} />
        </PageBody>
      </>
    );
  }
  return <OrderView order={order.data} />;
}

function OrderView({ order: o }: { order: OrderDto }) {
  const format = useMoney();
  const tz = useTimezone();
  const { user } = useSession();
  const isSupplier = user.role === 'SUPPLIER';
  const isStore = user.role === 'STORE';
  const isStaff = user.role === 'STAFF';
  const open = OPEN.includes(o.status);
  const delivered = o.status === 'DELIVERED' || o.status === 'PARTIALLY_DELIVERED';
  const [cancelling, setCancelling] = useState(false);
  const [reversing, setReversing] = useState<OrderPaymentDto | null>(null);

  return (
    <>
      <PageHeader title={`Order #${o.orderNumber}`} subtitle={`Placed ${formatDateTime(o.orderDate, tz)}`} back={true} />
      <PageBody>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {!isStore ? (
                <Link to={`/stores/${o.storeId}`} className="block truncate text-lg font-semibold text-brand-700">
                  {o.storeName}
                </Link>
              ) : (
                <p className="truncate text-lg font-semibold text-ink">{o.storeName}</p>
              )}
              {o.deliveredAt ? (
                <p className="text-sm text-muted">Delivered {formatDateTime(o.deliveredAt, tz)}</p>
              ) : o.deliveryDate && open ? (
                <p className="flex items-center gap-1 text-sm text-muted">
                  <CalendarDays className="size-4" aria-hidden /> Wanted {formatDate(o.deliveryDate, tz)}
                </p>
              ) : null}
              {o.source === 'STORE' && isSupplier ? <p className="text-sm text-muted">Ordered by the client</p> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <OrderStatusBadge status={o.status} />
              {delivered ? <PaymentBadge status={o.paymentStatus} /> : null}
            </div>
          </div>
          {o.cancelReason ? <p className="mt-3 text-sm text-muted">Cancelled: {o.cancelReason}</p> : null}
          {o.stockWarning ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-warn">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Stock went below zero with this delivery. Check your inventory count.
            </p>
          ) : null}
        </Card>

        {isSupplier ? <SupplierActions order={o} /> : null}
        {isSupplier ? <AssignControl order={o} /> : null}
        {isStaff && o.assignedTo?.id === user.id && (open || o.status === 'PARTIALLY_DELIVERED') ? <StaffDeliver order={o} /> : null}

        <section>
          <SectionTitle>Items</SectionTitle>
          <ListCard>
            {o.items.map((i) => (
              <ListRow
                key={i.productId}
                title={`${i.quantity} × ${i.productName}`}
                subtitle={[
                  `${format(i.unitPrice)} each`,
                  i.delivered > 0 && i.delivered !== i.quantity ? `${i.delivered} delivered` : null,
                  i.emptyCollected ? `${i.emptyCollected} empties back` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className="font-semibold tabular">
                    {/* Before delivery: the estimate. After: what was actually delivered. */}
                    {format(open ? i.lineTotal : fromMinor(lineTotalMinor(toMinor(i.unitPrice), i.delivered)))}
                  </span>
                }
              />
            ))}
          </ListCard>
        </section>

        <Card className="p-4">
          <dl className="space-y-1.5 text-[15px]">
            {o.discount !== '0.00' ? (
              <>
                <SummaryRow label="Subtotal" value={format(o.subtotal)} />
                <SummaryRow label="Discount" value={`−${format(o.discount)}`} />
              </>
            ) : null}
            <SummaryRow
              label={open ? 'Estimated total' : o.status === 'CANCELLED' ? 'Total (cancelled, not owed)' : 'Total'}
              value={format(o.total)}
              strong
            />
            {delivered ? <SummaryRow label="Paid" value={format(o.amountPaid)} /> : null}
            {delivered && o.creditAmount !== '0.00' ? <SummaryRow label="On credit" value={format(o.creditAmount)} tone="bad" /> : null}
          </dl>
          {open ? <p className="mt-2 text-sm text-muted">The final bill is based on what is actually delivered.</p> : null}
        </Card>

        {o.payments.length > 0 ? (
          <section>
            <SectionTitle>Payments</SectionTitle>
            <ListCard>
              {o.payments.map((p) => (
                <ListRow
                  key={p.id}
                  title={METHOD_LABEL[p.method]}
                  subtitle={formatDateTime(p.paymentDate, tz)}
                  trailing={
                    <span className="flex items-center gap-2">
                      {p.reversed ? <Badge>Reversed</Badge> : null}
                      <span className={`font-semibold tabular ${p.reversed ? 'text-muted line-through' : 'text-ok'}`}>{format(p.amount)}</span>
                      {isSupplier && !p.reversed ? (
                        <button type="button" onClick={() => setReversing(p)} className="h-11 px-1 text-sm font-semibold text-bad">
                          Reverse
                        </button>
                      ) : null}
                    </span>
                  }
                />
              ))}
            </ListCard>
          </section>
        ) : null}

        {o.notes ? (
          <Card className="px-4 py-3 text-[15px] text-ink-2">
            <span className="text-muted">Note: </span>
            {o.notes}
          </Card>
        ) : null}

        {o.status !== 'CANCELLED' && (isSupplier || (isStore && o.status === 'PENDING')) ? (
          <Button variant="dangerGhost" block onClick={() => setCancelling(true)}>
            {delivered ? 'Cancel delivery' : 'Cancel order'}
          </Button>
        ) : null}
      </PageBody>

      <CancelOrderSheet order={o} open={cancelling} onClose={() => setCancelling(false)} asStore={!isSupplier} />
      <ReversePaymentSheet payment={reversing} onClose={() => setReversing(null)} />
    </>
  );
}

function SupplierActions({ order: o }: { order: OrderDto }) {
  const navigate = useNavigate();
  const status = useOrderStatus(o.id);
  const canDeliver = OPEN.includes(o.status) || o.status === 'PARTIALLY_DELIVERED';
  if (!canDeliver) return null;

  const next = o.status === 'PENDING' ? 'CONFIRMED' : o.status === 'CONFIRMED' ? 'OUT_FOR_DELIVERY' : null;
  const setStatus = (s: 'CONFIRMED' | 'OUT_FOR_DELIVERY') =>
    status.mutate(s, { onError: (err) => toast.error(errorMessage(err)) });

  return (
    <div className={next ? 'grid grid-cols-2 gap-3' : ''}>
      {next ? (
        <Button variant="secondary" size="lg" loading={status.isPending} onClick={() => setStatus(next)}>
          {next === 'CONFIRMED' ? 'Accept' : 'Out for delivery'}
        </Button>
      ) : null}
      <Button size="lg" block icon={<Truck className="size-5" />} onClick={() => void navigate(`/orders/${o.id}/deliver`)}>
        {o.status === 'PARTIALLY_DELIVERED' ? 'Deliver rest' : 'Deliver'}
      </Button>
    </div>
  );
}

/** Staff: deliver an order the owner gave them. */
function StaffDeliver({ order: o }: { order: OrderDto }) {
  const navigate = useNavigate();
  return (
    <Button size="lg" block icon={<Truck className="size-5" />} onClick={() => void navigate(`/orders/${o.id}/deliver`)}>
      {o.status === 'PARTIALLY_DELIVERED' ? 'Deliver rest' : 'Deliver'}
    </Button>
  );
}

/** Owner: who delivers this order. Staff get a notification and see it in their day. */
function AssignControl({ order: o }: { order: OrderDto }) {
  const canAssign = OPEN.includes(o.status) || o.status === 'PARTIALLY_DELIVERED';
  const staff = useStaffList(canAssign);
  const assign = useAssignOrder(o.id);
  const active = staff.data?.filter((s) => s.active) ?? [];
  if (!canAssign) return o.assignedTo ? <p className="px-1 text-sm text-muted">Delivered by {o.assignedTo.name}</p> : null;
  if (!staff.data || (active.length === 0 && !o.assignedTo)) return null;
  return (
    <Card className="flex items-center justify-between gap-3 px-4 py-3">
      <label htmlFor="assign-staff" className="text-[15px] font-medium text-ink-2">
        Delivered by
      </label>
      <select
        id="assign-staff"
        className="h-11 min-w-0 rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-ink"
        value={o.assignedTo?.id ?? ''}
        disabled={assign.isPending}
        onChange={(e) =>
          assign.mutate(e.target.value || null, {
            onSuccess: (order) =>
              toast.success(order.assignedTo ? `Given to ${order.assignedTo.name}. They've been notified.` : 'You will deliver this order.'),
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      >
        <option value="">Me (owner)</option>
        {active.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Card>
  );
}
