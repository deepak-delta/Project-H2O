import { zodResolver } from '@hookform/resolvers/zod';
import { productInputSchema, type ProductDto } from '@wd/shared';
import { Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field } from '../../components/ui/Field';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { MoneyField, sanitizeMoneyInput } from '../../components/ui/MoneyField';
import { Segmented } from '../../components/ui/Segmented';
import { Sheet } from '../../components/ui/Sheet';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useMoney } from '../../hooks/useMoney';
import { ApiError, errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useProducts, useSaveProduct } from './api';

type FormInput = z.input<typeof productInputSchema>;
type FormOutput = z.output<typeof productInputSchema>;

export default function ProductsPage() {
  const products = useProducts({ all: true });
  const format = useMoney();
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Products & prices"
        back="/more"
        action={
          <Button variant="ghost" icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>
            Add
          </Button>
        }
      />
      <PageBody>
        {products.isPending ? (
          <ListSkeleton rows={3} />
        ) : products.isError ? (
          <ErrorRetry message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
        ) : products.data.length === 0 ? (
          <EmptyState
            icon={<Package className="size-6" />}
            title="No products yet"
            description="Add what you deliver, like a 20L water can."
            action={<Button onClick={() => setEditing('new')}>Add product</Button>}
          />
        ) : (
          <ListCard>
            {products.data.map((p) => (
              <ListRow
                key={p.id}
                onClick={() => setEditing(p)}
                title={p.name}
                subtitle={[p.isReturnable ? 'Returnable can' : 'Not returned', p.depositAmount !== '0.00' ? `deposit ${format(p.depositAmount)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-semibold tabular">{format(p.sellingPrice)}</span>
                    {!p.active ? <Badge>Hidden</Badge> : null}
                  </span>
                }
              />
            ))}
          </ListCard>
        )}
      </PageBody>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add product' : 'Edit product'}>
        {editing !== null ? (
          <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Sheet>
    </>
  );
}

export function ProductForm({ product, onDone }: { product?: ProductDto; onDone: (saved: ProductDto) => void }) {
  const save = useSaveProduct();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(productInputSchema),
    defaultValues: {
      name: product?.name ?? '20L water can',
      capacityLiters: product?.capacityLiters ?? '20',
      sellingPrice: product?.sellingPrice.replace(/\.00$/, '') ?? '',
      depositAmount: product?.depositAmount.replace(/\.00$/, '') ?? '0',
      isReturnable: product?.isReturnable ?? true,
      active: product?.active ?? true,
    },
  });

  const onSubmit = handleSubmit((input) =>
    save.mutate(
      { id: product?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(product ? 'Product updated.' : `${saved.name} added.`);
          onDone(saved);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.fields) {
            for (const [field, message] of Object.entries(err.fields)) setError(field as keyof FormInput, { message });
          } else {
            toast.error(errorMessage(err));
          }
        },
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <div className="grid grid-cols-2 gap-3">
        <Controller
          control={control}
          name="sellingPrice"
          render={({ field }) => (
            <MoneyField
              label="Price per can"
              value={field.value}
              onChange={(e) => field.onChange(sanitizeMoneyInput(e.target.value))}
              error={errors.sellingPrice?.message}
            />
          )}
        />
        <Field label="Litres" inputMode="decimal" error={errors.capacityLiters?.message} {...register('capacityLiters')} />
      </div>
      <Controller
        control={control}
        name="isReturnable"
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Do stores return the empty container?</span>
            <Segmented
              label="Returnable"
              value={field.value ? 'yes' : 'no'}
              onChange={(v) => field.onChange(v === 'yes')}
              options={[
                { value: 'yes', label: 'Yes, track cans' },
                { value: 'no', label: 'No' },
              ]}
            />
            {errors.isReturnable?.message ? <p className="text-sm text-bad">{errors.isReturnable.message}</p> : null}
          </div>
        )}
      />
      {product ? (
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Segmented
              label="Show in new orders"
              value={field.value ? 'on' : 'off'}
              onChange={(v) => field.onChange(v === 'on')}
              options={[
                { value: 'on', label: 'Selling' },
                { value: 'off', label: 'Hidden' },
              ]}
            />
          )}
        />
      ) : null}
      <Button type="submit" size="lg" block loading={save.isPending}>
        {product ? 'Save' : 'Add product'}
      </Button>
    </form>
  );
}
