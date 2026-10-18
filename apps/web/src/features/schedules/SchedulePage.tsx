import { zonedDateKey, type ProductDto, type ScheduleDto, type StoreDetail } from '@wd/shared';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { Segmented } from '../../components/ui/Segmented';
import { ConfirmSheet } from '../../components/ui/Sheet';
import { PageSpinner } from '../../components/ui/Spinner';
import { useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { toast } from '../../stores/toast';
import { useProducts } from '../catalog/api';
import { useStore } from '../stores/api';
import { useDeleteSchedule, useSaveSchedule, useSchedule } from './api';
import { draftFrom, draftToInput, newDraft, ScheduleEditor } from './ScheduleEditor';

/** Owner: set up, change, pause or stop a client's regular delivery. */
export default function SchedulePage() {
  const { id = '' } = useParams();
  const store = useStore(id);
  const products = useProducts();
  const schedule = useSchedule(id);
  if (store.isPending || products.isPending || schedule.isPending) return <PageSpinner />;
  const failed = store.error ?? products.error ?? schedule.error;
  if (failed || !store.data || !products.data || schedule.data === undefined) {
    return (
      <>
        <PageHeader title="Regular delivery" back={true} />
        <PageBody>
          <ErrorRetry
            message={errorMessage(failed)}
            onRetry={() => {
              void store.refetch();
              void products.refetch();
              void schedule.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }
  return <ScheduleForm store={store.data} products={products.data} existing={schedule.data} />;
}

function ScheduleForm({ store, products, existing }: { store: StoreDetail; products: ProductDto[]; existing: ScheduleDto | null }) {
  const tz = useTimezone();
  const navigate = useNavigate();
  const save = useSaveSchedule();
  const remove = useDeleteSchedule(store.id);
  const [draft, setDraft] = useState(() => (existing ? draftFrom(existing) : newDraft(tz, products)));
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const today = zonedDateKey(new Date(), tz);

  const submit = () => {
    setError(null);
    const result = draftToInput(draft);
    if ('error' in result) return setError(result.error);
    save.mutate(
      { storeId: store.id, input: result.input },
      {
        onSuccess: () => {
          toast.success(draft.active ? 'Regular delivery saved.' : 'Regular delivery paused.');
          void navigate(`/stores/${store.id}`, { replace: true });
        },
        onError: (err) => setError(errorMessage(err, 'The regular delivery was not saved. Please try again.')),
      },
    );
  };

  return (
    <>
      <PageHeader title="Regular delivery" subtitle={store.name} back={true} />
      <div className="flex flex-col gap-5 px-safe pt-4 pb-40">
        {existing ? (
          <Segmented
            label="Regular delivery on or paused"
            size="lg"
            value={draft.active ? 'on' : 'paused'}
            onChange={(v) => setDraft({ ...draft, active: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'paused', label: 'Paused' },
            ]}
          />
        ) : null}
        <ScheduleEditor draft={draft} onChange={setDraft} products={products} today={today} />
        {existing ? (
          <Button variant="dangerGhost" block onClick={() => setConfirmStop(true)}>
            Stop regular delivery
          </Button>
        ) : null}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-safe pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="mx-auto max-w-xl">
          {error ? (
            <p role="alert" className="mb-2 flex items-center gap-1.5 text-sm text-bad">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <Button size="lg" block loading={save.isPending} onClick={submit}>
            {existing ? 'Save changes' : 'Start regular delivery'}
          </Button>
        </div>
      </div>
      <ConfirmSheet
        open={confirmStop}
        title="Stop regular delivery?"
        message={`No more orders will be made for ${store.name}. Orders already made stay as they are. To stop for a while, choose Paused instead.`}
        confirmLabel="Stop"
        loading={remove.isPending}
        onClose={() => setConfirmStop(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success('Regular delivery stopped.');
              void navigate(`/stores/${store.id}`, { replace: true });
            },
            onError: (err) => {
              setConfirmStop(false);
              toast.error(errorMessage(err, "Couldn't stop it. Please try again."));
            },
          })
        }
      />
    </>
  );
}
