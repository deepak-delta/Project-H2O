import type { StockMovementInput, StockSummary } from '@wd/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Segmented } from '../../components/ui/Segmented';
import { Sheet } from '../../components/ui/Sheet';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useStockMovement } from './api';

export type StockAction = 'PURCHASE' | 'REFILL' | 'DAMAGE' | 'COUNT';

const TITLES: Record<StockAction, string> = {
  PURCHASE: 'Add stock',
  REFILL: 'Refill empties',
  DAMAGE: 'Damaged or lost',
  COUNT: 'Correct count',
};

interface Props {
  action: StockAction | null;
  product: StockSummary;
  onClose: () => void;
  /** Pre-filled amount (e.g. the refill that brings filled cans back to zero). */
  initialQuantity?: number;
  initialReason?: string;
}

/** Every warehouse change in one sheet; each records an inventory movement, never a silent edit. */
export function StockActionSheet({ action, product, onClose, initialQuantity, initialReason }: Props) {
  return (
    <Sheet open={action !== null} onClose={onClose} title={action ? `${TITLES[action]} · ${product.productName}` : ''}>
      {action ? (
        <StockActionForm key={action} action={action} product={product} onDone={onClose} initialQuantity={initialQuantity} initialReason={initialReason} />
      ) : null}
    </Sheet>
  );
}

function StockActionForm({
  action,
  product,
  onDone,
  initialQuantity = 0,
  initialReason = '',
}: {
  action: StockAction;
  product: StockSummary;
  onDone: () => void;
  initialQuantity?: number;
  initialReason?: string;
}) {
  const move = useStockMovement();
  const [clientId] = useState(() => crypto.randomUUID());
  const [filled, setFilled] = useState(action === 'COUNT' ? Math.max(product.filled, 0) : 0);
  const [empty, setEmpty] = useState(action === 'COUNT' ? Math.max(product.empty, 0) : 0);
  // Only returnable cans have a damaged pile to count.
  const countDamaged = action === 'COUNT' && product.isReturnable;
  const [damaged, setDamaged] = useState(Math.max(product.damaged, 0));
  const [quantity, setQuantity] = useState(initialQuantity);
  const [from, setFrom] = useState<'FILLED' | 'EMPTY'>('EMPTY');
  const [kind, setKind] = useState<'DAMAGE' | 'LOSS'>('DAMAGE');
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState<string | null>(null);
  // Count corrections overwrite what the app believes, so they get a second look first.
  const [confirming, setConfirming] = useState(false);

  const build = (): StockMovementInput | string => {
    const base = { clientId, productId: product.productId };
    switch (action) {
      case 'PURCHASE':
        return filled + empty > 0 ? { ...base, kind: 'PURCHASE', filled, empty, reason } : 'Enter how many cans.';
      case 'REFILL':
        return quantity > 0 ? { ...base, kind: 'REFILL', quantity, reason } : 'Enter how many cans were refilled.';
      case 'DAMAGE':
        return quantity > 0 ? { ...base, kind, from, quantity, reason } : 'Enter how many cans.';
      case 'COUNT':
        if (reason.trim().length < 3) return 'Say why the count changed (e.g. "Weekly count").';
        return { ...base, kind: 'ADJUSTMENT', countedFilled: filled, countedEmpty: empty, ...(countDamaged ? { countedDamaged: damaged } : {}), reason };
    }
  };

  const submit = () => {
    const input = build();
    if (typeof input === 'string') return setError(input);
    setError(null);
    if (action === 'COUNT' && !confirming) {
      if (filled === product.filled && empty === product.empty && (!countDamaged || damaged === product.damaged)) {
        return setError('The count already matches the app.');
      }
      return setConfirming(true);
    }
    move.mutate(input, {
      onSuccess: () => {
        toast.success('Stock updated.');
        onDone();
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {action === 'PURCHASE' ? (
        <>
          <p className="text-sm text-muted">New cans received from your supplier or bought.</p>
          <QuantityStepper label="Filled cans" value={filled} onChange={setFilled} />
          <QuantityStepper label="Empty cans" value={empty} onChange={setEmpty} />
        </>
      ) : null}

      {action === 'REFILL' ? (
        <>
          <p className="text-sm text-muted">Empty cans filled at the plant. {product.empty} empties in stock.</p>
          <QuantityStepper label="Cans refilled" value={quantity} onChange={setQuantity} max={Math.max(product.empty, 0)} />
          {product.empty > 0 && quantity !== product.empty ? (
            <button
              type="button"
              onClick={() => setQuantity(product.empty)}
              className="h-9 self-start rounded-full border border-line-strong px-3 text-sm font-medium text-brand-700"
            >
              All {product.empty} empties
            </button>
          ) : null}
        </>
      ) : null}

      {action === 'DAMAGE' ? (
        <>
          <Segmented
            label="What happened"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'DAMAGE', label: 'Damaged' },
              { value: 'LOSS', label: 'Lost' },
            ]}
          />
          <Segmented
            label="Which cans"
            value={from}
            onChange={setFrom}
            options={[
              { value: 'EMPTY', label: `Empty (${product.empty})` },
              { value: 'FILLED', label: `Filled (${product.filled})` },
            ]}
          />
          <QuantityStepper label="Cans" value={quantity} onChange={setQuantity} />
        </>
      ) : null}

      {action === 'COUNT' ? (
        <>
          <p className="text-sm text-muted">
            Enter what you actually counted. The difference is recorded as an adjustment, and the old numbers are kept.
          </p>
          <QuantityStepper label="Filled cans counted" hint={`App says ${product.filled}`} value={filled} onChange={setFilled} />
          <QuantityStepper label="Empty cans counted" hint={`App says ${product.empty}`} value={empty} onChange={setEmpty} />
          {countDamaged ? (
            <QuantityStepper
              label="Damaged cans counted"
              hint={`App says ${product.damaged}. Thrown away? Count only the ones still here.`}
              value={damaged}
              onChange={setDamaged}
            />
          ) : null}
          <p className="text-sm text-muted">Lost cans that turned up again: count them with the filled or empty cans.</p>
        </>
      ) : null}

      <Field
        label={action === 'COUNT' ? 'Reason' : 'Note (optional)'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={action === 'COUNT' ? 'e.g. Weekly count' : undefined}
      />
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <div role="alert" className="rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn">
          <p className="font-semibold">Record this correction?</p>
          <p>
            Filled {product.filled} → {filled} ({signed(filled - product.filled)}), empty {product.empty} → {empty} (
            {signed(empty - product.empty)})
            {countDamaged ? `, damaged ${product.damaged} → ${damaged} (${signed(damaged - product.damaged)})` : ''}.
          </p>
        </div>
      ) : null}
      <div className={confirming ? 'grid grid-cols-2 gap-3' : ''}>
        {confirming ? (
          <Button variant="secondary" size="lg" onClick={() => setConfirming(false)} disabled={move.isPending}>
            Go back
          </Button>
        ) : null}
        <Button size="lg" block loading={move.isPending} onClick={submit}>
          {confirming ? 'Confirm' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}
