import { addDays, EXPENSE_CATEGORIES, isMoneyString, MANUAL_INCOME_CATEGORIES, toMinor, zonedDateKey, type PaymentMethod } from '@wd/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { Segmented } from '../../components/ui/Segmented';
import { Sheet } from '../../components/ui/Sheet';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { cn } from '../../utils/cn';
import { PAYMENT_METHOD_OPTIONS } from '../orders/DeliveryForm';
import { useAddCashEntry } from './api';
import { CATEGORY_LABEL } from './labels';

type Kind = 'EXPENSE' | 'INCOME';
type Day = 'today' | 'yesterday';
/** Categories a person can enter by hand (sales income comes from payments). */
type ManualCategory = (typeof EXPENSE_CATEGORIES)[number] | (typeof MANUAL_INCOME_CATEGORIES)[number];

export function AddEntrySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add money in / out">
      {open ? <AddEntryForm onDone={onClose} /> : null}
    </Sheet>
  );
}

/** Category chips + amount: an expense takes three taps and a number. */
function AddEntryForm({ onDone }: { onDone: () => void }) {
  const add = useAddCashEntry();
  const format = useMoney();
  const tz = useTimezone();
  const [clientId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<Kind>('EXPENSE');
  const [category, setCategory] = useState<ManualCategory | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [day, setDay] = useState<Day>('today');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const categories: readonly ManualCategory[] = kind === 'EXPENSE' ? EXPENSE_CATEGORIES : MANUAL_INCOME_CATEGORIES;

  const submit = () => {
    if (!category) return setError('Choose what it was for.');
    if (!isMoneyString(amount) || toMinor(amount) <= 0) return setError('Enter the amount.');
    setError(null);
    const today = zonedDateKey(new Date(), tz);
    const title = `${CATEGORY_LABEL[category]} ${format(amount)}`;
    add.mutate(
      {
        input: {
          clientId,
          type: kind,
          category,
          amount,
          method,
          date: day === 'today' ? today : addDays(today, -1),
          description: description.trim() || undefined,
        },
        title,
      },
      {
        onSuccess: (res) => {
          if (res.queued) toast.info(`${title} saved on this phone. It will sync when you're back online.`);
          else toast.success(`${title} saved.`);
          onDone();
        },
        onError: (err) => setError(errorMessage(err, 'Not saved. Check your connection and try again.')),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Segmented<Kind>
        label="Money in or out"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategory(null);
        }}
        options={[
          { value: 'EXPENSE', label: 'Expense' },
          { value: 'INCOME', label: 'Other income' },
        ]}
      />
      <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
              category === c ? 'border-brand-700 bg-brand-700 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-canvas',
            )}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <MoneyField label="Amount" value={amount} onChange={(e) => setAmount(sanitizeMoneyInput(e.target.value))} />
      <Segmented<PaymentMethod> label="Paid by" value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} />
      <Segmented<Day>
        label="When"
        value={day}
        onChange={setDay}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'yesterday', label: 'Yesterday' },
        ]}
      />
      <Field label="Note (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button size="lg" block loading={add.isPending} onClick={submit}>
        Save
      </Button>
    </div>
  );
}
