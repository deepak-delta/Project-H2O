import { zodResolver } from '@hookform/resolvers/zod';
import { createStoreSchema, formatPhone, type StoreDetail } from '@wd/shared';
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
import { useCreateStore, useStore, useUpdateStore } from './api';

type FormInput = z.input<typeof createStoreSchema>;
type FormOutput = z.output<typeof createStoreSchema>;

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

function StoreForm({ existing }: { existing?: StoreDetail }) {
  const navigate = useNavigate();
  const create = useCreateStore();
  const update = useUpdateStore(existing?.id ?? '');
  const products = useProducts();
  const [showOpening, setShowOpening] = useState(false);
  const returnable = products.data?.filter((p) => p.isReturnable) ?? [];

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createStoreSchema),
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

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit((values) => {
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
          toast.success('Store updated.');
          void navigate(`/stores/${existing.id}`, { replace: true });
        },
        onError,
      });
    } else {
      create.mutate(values, {
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
