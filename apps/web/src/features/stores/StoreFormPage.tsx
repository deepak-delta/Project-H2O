import { zodResolver } from '@hookform/resolvers/zod';
import { createStoreSchema, formatPhone, moneySchema, type ProductDto, type StoreDetail } from '@wd/shared';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { PageSpinner } from '../../components/ui/Spinner';
import { ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useProducts } from '../catalog/api';
import { useCreateStore, usePriceSuggestions, useSetStorePrices, useStore, useUpdateStore } from './api';

// Prices are collected separately (one box per product), so the form itself leaves them out.
const storeFormSchema = createStoreSchema.omit({ prices: true });
type FormInput = z.input<typeof storeFormSchema>;
type FormOutput = z.output<typeof storeFormSchema>;

export default function StoreFormPage() {
  const { id } = useParams();
  const store = useStore(id);
  if (!id) return <StoreForm />;
  if (store.isPending) return <PageSpinner />;
  if (store.isError) {
    return (
      <>
        <PageHeader title="Edit store" back={true} />
        <PageBody>
          <ErrorRetry message={errorMessage(store.error)} onRetry={() => void store.refetch()} />
        </PageBody>
      </>
    );
  }
  return <StoreForm existing={store.data} />;
}

const priceSchema = moneySchema({ allowZero: false });

function StoreForm({ existing }: { existing?: StoreDetail }) {
  const navigate = useNavigate();
  const create = useCreateStore();
  const update = useUpdateStore(existing?.id ?? '');
  const savePrices = useSetStorePrices(existing?.id ?? '');
  const products = useProducts();
  const suggestions = usePriceSuggestions();
  const [showOpening, setShowOpening] = useState(false);
  const returnable = products.data?.filter((p) => p.isReturnable) ?? [];
  // Prices are kept outside the form library: one box per product, filled once the lists load.
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const startingPrice = (productId: string) =>
    (existing?.prices ?? suggestions.data ?? []).find((p) => p.productId === productId)?.price.replace(/\.00$/, '') ?? '';
  const priceOf = (productId: string) => prices[productId] ?? startingPrice(productId);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: existing?.name ?? '',
      ownerName: existing?.ownerName ?? '',
      phone: existing?.phone ? formatPhone(existing.phone) : '',
      address: existing?.address ?? '',
      notes: existing?.notes ?? '',
      creditLimit: existing?.creditLimit ?? '',
      openingBalance: '',
      openingCans: [],
    },
  });

  const pending = create.isPending || update.isPending || savePrices.isPending;

  /** Every product needs a price for a new store; when editing, an empty box leaves it unset. */
  const collectPrices = (): { productId: string; price: string }[] | null => {
    const errs: Record<string, string> = {};
    const out: { productId: string; price: string }[] = [];
    for (const p of products.data ?? []) {
      const raw = priceOf(p.id).trim();
      if (!raw && existing) continue;
      const parsed = priceSchema.safeParse(raw);
      if (parsed.success) out.push({ productId: p.id, price: parsed.data });
      else errs[p.id] = raw ? 'Enter a price, e.g. 40' : 'Enter this store\'s price';
    }
    setPriceErrors(errs);
    return Object.keys(errs).length ? null : out;
  };

  const onSubmit = handleSubmit((values) => {
    const storePrices = collectPrices();
    if (!storePrices) {
      toast.error("Enter this store's price for each product.");
      return;
    }
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) setError(field as keyof FormInput, { message });
      }
      toast.error(errorMessage(err, 'Store was not saved. Please try again.'));
    };
    if (existing) {
      const { openingBalance: _ob, openingCans: _oc, ...rest } = values;
      update.mutate(rest, {
        onSuccess: () => {
          const done = () => {
            toast.success('Store updated.');
            void navigate(`/stores/${existing.id}`, { replace: true });
          };
          if (storePrices.length === 0) return done();
          savePrices.mutate({ prices: storePrices }, { onSuccess: done, onError });
        },
        onError,
      });
    } else {
      create.mutate({ ...values, prices: storePrices }, {
        onSuccess: (store) => {
          toast.success(`${store.name} added.`);
          void navigate(`/stores/${store.id}`, { replace: true });
        },
        onError,
      });
    }
  });

  return (
    <>
      <PageHeader title={existing ? 'Edit store' : 'Add store'} back={true} />
      <form onSubmit={onSubmit} noValidate>
        <PageBody>
          <Card className="flex flex-col gap-4 p-4">
            <Field label="Store name" autoFocus={!existing} error={errors.name?.message} {...register('name')} />
          </Card>

          <PricesCard
            products={products.data}
            loading={products.isPending || (!existing && suggestions.isPending)}
            editing={Boolean(existing)}
            priceOf={priceOf}
            errors={priceErrors}
            onChange={(productId, value) => {
              setPrices((p) => ({ ...p, [productId]: value }));
              setPriceErrors(({ [productId]: _cleared, ...rest }) => rest);
            }}
          />

          <Card className="flex flex-col gap-4 p-4">
            <Field label="Owner name (optional)" autoComplete="off" error={errors.ownerName?.message} {...register('ownerName')} />
            <Field
              label="Phone (optional)"
              type="tel"
              inputMode="tel"
              prefix="+91"
              placeholder="98765 43210"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <Field label="Address (optional)" error={errors.address?.message} {...register('address')} />
            <Controller
              control={control}
              name="creditLimit"
              render={({ field }) => (
                <MoneyField
                  label="Credit limit (optional)"
                  hint="You'll be warned when a delivery takes them over this."
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(sanitizeMoneyInput(e.target.value))}
                  error={errors.creditLimit?.message}
                />
              )}
            />
            <Field label="Notes (optional)" error={errors.notes?.message} {...register('notes')} />
          </Card>


          {!existing ? (
            showOpening ? (
              <Card className="flex flex-col gap-4 p-4">
                <div>
                  <p className="font-semibold text-ink">Bring over from your notebook</p>
                  <p className="text-sm text-muted">What this store already owes and how many of your cans it has.</p>
                </div>
                <Controller
                  control={control}
                  name="openingBalance"
                  render={({ field }) => (
                    <MoneyField
                      label="Amount they owe now"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(sanitizeMoneyInput(e.target.value))}
                      error={errors.openingBalance?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="openingCans"
                  render={({ field }) => {
                    const value = field.value ?? [];
                    return (
                      <>
                        {returnable.map((p) => (
                          <QuantityStepper
                            key={p.id}
                            size="md"
                            label={`${p.name} at store`}
                            value={value.find((c) => c.productId === p.id)?.quantity ?? 0}
                            onChange={(quantity) =>
                              field.onChange([...value.filter((c) => c.productId !== p.id), { productId: p.id, quantity }])
                            }
                          />
                        ))}
                      </>
                    );
                  }}
                />
              </Card>
            ) : (
              <button
                type="button"
                onClick={() => setShowOpening(true)}
                className="flex min-h-14 items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-4 text-left"
              >
                <span>
                  <span className="block font-medium text-ink">Already supplying this store?</span>
                  <span className="block text-sm text-muted">Add the amount they owe and cans they have</span>
                </span>
                <ChevronRight className="size-5 text-muted" aria-hidden />
              </button>
            )
          ) : null}

          <Button type="submit" size="lg" block loading={pending}>
            {existing ? 'Save changes' : 'Add store'}
          </Button>
        </PageBody>
      </form>
    </>
  );
}

function PricesCard({
  products,
  loading,
  editing,
  priceOf,
  errors,
  onChange,
}: {
  products: ProductDto[] | undefined;
  loading: boolean;
  editing: boolean;
  priceOf: (productId: string) => string;
  errors: Record<string, string>;
  onChange: (productId: string, value: string) => void;
}) {
  if (loading) return <Card className="h-28 animate-pulse p-4" aria-busy />;
  if (!products?.length) return null;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <p className="font-semibold text-ink">Price for this store</p>
        <p className="text-sm text-muted">
          {editing ? 'Changes apply to new deliveries. Past bills keep their price.' : 'What this store pays per item. Each store can have its own price.'}
        </p>
      </div>
      {products.map((p) => (
        <MoneyField
          key={p.id}
          label={`Price per ${p.name}`}
          value={priceOf(p.id)}
          onChange={(e) => onChange(p.id, sanitizeMoneyInput(e.target.value))}
          error={errors[p.id]}
        />
      ))}
    </Card>
  );
}
