import { Button } from './Button';

/** Explicit "Load more" instead of infinite scroll: predictable and cheap on low-end phones. */
export function LoadMore({
  hasMore,
  loading,
  onLoad,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  if (!hasMore) return null;
  return (
    <Button variant="ghost" block loading={loading} onClick={onLoad}>
      Load more
    </Button>
  );
}

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface px-4 py-4 text-center">
      <p className="text-sm text-ink-2">{message}</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
