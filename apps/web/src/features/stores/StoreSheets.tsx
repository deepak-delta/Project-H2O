import { isMoneyString, toMinor, type PaymentMethod, type StoreDetail } from '@wd/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Segmented } from '../../components/ui/Segmented';
import { Sheet } from '../../components/ui/Sheet';
import { BalanceText } from '../../components/ui/Stat';
import { useMoney } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useCanReturn, useRecordPayment, useSetClientCans } from './api';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank' },
  { value: 'OTHER', label: 'Other' },
];

export function RecordPaymentSheet({ store, open, onClose }: { store: StoreDetail; open: boolean; onClose: () => void }) {
  const format = useMoney();
  const record = useRecordPayment();
  const owes = toMinor(store.balance) > 0;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Kept for the life of the sheet so a retry after a dropped connection is not a second payment.
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  const close = () => {
    setAmount('');
    setReference('');
    setError(null);
    setClientId(crypto.randomUUID());
    onClose();
  };

  const submit = () => {
    if (!isMoneyString(amount) || toMinor(amount) <= 0) return setError('Enter the amount received.');
    setError(null);
    record.mutate(
      {
        input: { clientId, storeId: store.id, amount, method, referenceNumber: reference.trim() || undefined },
        summary: { title: `Payment ${format(amount)}`, detail: store.name, storeId: store.id },
      },
      {
        onSuccess: (res) => {
          if (res.queued) toast.info(`${format(amount)} saved on this phone. It will sync when you're back online.`);
          else toast.success(`${format(res.data.payment.amount)} received. New balance ${format(res.data.storeBalance)}.`);
          close();
        },
        onError: (err) => setError(errorMessage(err, 'Payment was not saved. Check your connection and try again.')),
      },
    );
  };

  return (
    <Sheet open={open} onClose={close} title="Record payment">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-muted">
          {store.name}: <BalanceText balance={store.balance} format={format} />
        </p>
        <MoneyField
          label="Amount received"
          value={amount}
          onChange={(e) => setAmount(sanitizeMoneyInput(e.target.value))}
          error={error ?? undefined}
        />
        {owes ? (
          <button
            type="button"
            onClick={() => setAmount(store.balance)}
            className="h-9 self-start rounded-full border border-line-strong px-3 text-sm font-medium text-brand-700"
          >
            Full balance {format(store.balance)}
          </button>
        ) : null}
        <Segmented<PaymentMethod> label="Payment method" value={method} onChange={setMethod} options={METHODS} />
        {method !== 'CASH' ? (
          <Field label="Reference / UTR (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        ) : null}
        <Button size="lg" block loading={record.isPending} onClick={submit}>
          Save payment
        </Button>
      </div>
    </Sheet>
  );
}

export function CollectEmptiesSheet({ store, open, onClose }: { store: StoreDetail; open: boolean; onClose: () => void }) {
  const collect = useCanReturn(store.id);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const close = () => {
    setCounts({});
    setClientId(crypto.randomUUID());
    onClose();
  };

  const submit = () => {
    const label = `${total} empty can${total === 1 ? '' : 's'}`;
    collect.mutate(
      {
        input: { clientId, items: Object.entries(counts).map(([productId, quantity]) => ({ productId, quantity })) },
        summary: { title: `${label} collected`, detail: store.name, storeId: store.id },
      },
      {
        onSuccess: (res) => {
          if (res.queued) toast.info(`${label} saved on this phone. It will sync when you're back online.`);
          else toast.success(`${label} collected. Client now has ${res.data.cansOutstanding}.`);
          close();
        },
        onError: (err) => toast.error(errorMessage(err, 'Not saved. Check your connection and try again.')),
      },
    );
  };

  return (
    <Sheet open={open} onClose={close} title="Collect empty cans">
      <div className="flex flex-col gap-4">
        {store.cans.map((c) => (
          <QuantityStepper
            key={c.productId}
            label={c.productName}
            hint={`Client has ${c.quantity}`}
            value={counts[c.productId] ?? 0}
            onChange={(v) => setCounts((prev) => ({ ...prev, [c.productId]: v }))}
          />
        ))}
        <Button size="lg" block loading={collect.isPending} disabled={total === 0} onClick={submit}>
          Save {total > 0 ? `${total} empt${total === 1 ? 'y' : 'ies'}` : ''}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Owner: set how many cans are really at the client (cans already there + delivered − empties
 * back), e.g. cans they had that were never entered. Two steps: enter, then confirm the change.
 */
export function CorrectCansSheet({ store, open, onClose }: { store: StoreDetail; open: boolean; onClose: () => void }) {
  const save = useSetClientCans(store.id);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reviewing, setReviewing] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const countOf = (productId: string, current: number) => counts[productId] ?? current;
  const changes = store.cans.filter((c) => countOf(c.productId, c.quantity) !== c.quantity);

  const close = () => {
    setCounts({});
    setReviewing(false);
    setClientId(crypto.randomUUID());
    onClose();
  };

  const confirm = () =>
    save.mutate(
      { clientId, items: changes.map((c) => ({ productId: c.productId, quantity: countOf(c.productId, c.quantity) })) },
      {
        onSuccess: (res) => {
          toast.success(`Cans at ${store.name} set to ${res.cansOutstanding}.`);
          close();
        },
        onError: (err) => toast.error(errorMessage(err, 'Not saved. Check your connection and try again.')),
      },
    );

  return (
    <Sheet open={open} onClose={close} title="Correct cans at client">
      {reviewing ? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink-2">Change the cans recorded at {store.name}?</p>
          <ul className="flex flex-col gap-1 text-[15px]">
            {changes.map((c) => (
              <li key={c.productId} className="flex justify-between">
                <span>{c.productName}</span>
                <span className="font-semibold tabular">
                  {c.quantity} → {countOf(c.productId, c.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Saved as a correction in the client's can history. Your own stock doesn't change.</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" size="lg" onClick={() => setReviewing(false)} disabled={save.isPending}>
              Go back
            </Button>
            <Button size="lg" loading={save.isPending} onClick={confirm}>
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Cans with a client = cans they already had + full cans delivered − empties collected. Change it only if the real count is
            different, e.g. cans they had before you started using the app.
          </p>
          {store.cans.map((c) => (
            <QuantityStepper
              key={c.productId}
              label={c.productName}
              hint={`Recorded now: ${c.quantity}`}
              value={countOf(c.productId, c.quantity)}
              onChange={(v) => setCounts((prev) => ({ ...prev, [c.productId]: v }))}
            />
          ))}
          <Button size="lg" block disabled={changes.length === 0} onClick={() => setReviewing(true)}>
            Review change
          </Button>
        </div>
      )}
    </Sheet>
  );
}
