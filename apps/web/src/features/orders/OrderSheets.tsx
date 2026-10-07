import { toMinor, type OrderDto, type OrderPaymentDto } from '@wd/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Sheet } from '../../components/ui/Sheet';
import { useMoney } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useCancelOrder, useReversePayment } from './api';

/**
 * Cancelling is a destructive, hard-to-undo action, so it always gets this confirmation.
 * For delivered orders it explains exactly what will be reversed.
 */
export function CancelOrderSheet({ order, open, onClose, asStore }: { order: OrderDto; open: boolean; onClose: () => void; asStore?: boolean }) {
  const format = useMoney();
  const cancel = useCancelOrder(order.id);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const delivered = order.status === 'DELIVERED' || order.status === 'PARTIALLY_DELIVERED';
  const paid = toMinor(order.amountPaid) > 0;

  const confirm = () =>
    cancel.mutate(
      { reason: reason.trim() || undefined, refundPayments: delivered && paid && refund },
      {
        onSuccess: () => {
          toast.success(`Order #${order.orderNumber} cancelled.`);
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Sheet open={open} onClose={onClose} title={delivered ? 'Cancel this delivery?' : 'Cancel this order?'}>
      <div className="flex flex-col gap-4">
        {delivered ? (
          <div className="rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn">
            <p>This undoes the delivery: the {format(order.total)} bill is removed from the client's balance and the cans go back into your stock.</p>
            <p className="mt-1">Nothing is deleted; reversal entries are added to the history.</p>
          </div>
        ) : (
          <p className="text-[15px] text-ink-2">
            {asStore ? 'Your supplier will see that you cancelled it.' : 'Nothing has been delivered yet, so no money or stock changes.'}
          </p>
        )}
        {delivered && paid ? (
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3.5">
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="size-5 accent-brand-700" />
            <span className="text-[15px] text-ink">
              Also refund the {format(order.amountPaid)} they paid
              <span className="block text-sm text-muted">Otherwise it stays as credit for their next order.</span>
            </span>
          </label>
        ) : null}
        <Field label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={cancel.isPending}>
            Go back
          </Button>
          <Button variant="danger" size="lg" loading={cancel.isPending} onClick={confirm}>
            {delivered ? 'Cancel delivery' : 'Cancel order'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function ReversePaymentSheet({ payment, onClose }: { payment: Pick<OrderPaymentDto, 'id' | 'amount'> | null; onClose: () => void }) {
  const format = useMoney();
  const reverse = useReversePayment();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const confirm = () => {
    if (!payment) return;
    if (reason.trim().length < 3) return setError('Say why this payment is being reversed.');
    reverse.mutate(
      { paymentId: payment.id, reason: reason.trim() },
      {
        onSuccess: (res) => {
          toast.success(`Payment reversed. Client balance is now ${format(res.storeBalance)}.`);
          close();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Sheet open={payment !== null} onClose={close} title="Reverse this payment?">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-ink-2">
          {payment ? format(payment.amount) : ''} will be added back to what the client owes. The payment stays in the history,
          marked as reversed.
        </p>
        <Field label="Reason" placeholder="e.g. Entered twice by mistake" value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={close} disabled={reverse.isPending}>
            Go back
          </Button>
          <Button variant="danger" size="lg" loading={reverse.isPending} onClick={confirm}>
            Reverse
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
