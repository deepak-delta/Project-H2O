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
import { useCanReturn, useRecordPayment } from './api';

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
