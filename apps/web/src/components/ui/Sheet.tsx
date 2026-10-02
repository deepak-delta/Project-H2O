import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Bottom sheet built on the native <dialog> element: focus trapping, Esc to close and
 * background inertness come for free.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first button, the ×, which draws a focus ring on a sheet that
      // simply opened. Focus the sheet itself instead; Tab still reaches every control.
      if (document.activeElement === closeRef.current) dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      tabIndex={-1}
      className="m-0 mt-auto outline-none w-full max-w-none bg-transparent p-0 backdrop:bg-ink/40 sm:m-auto sm:max-w-md"
    >
      <div className="rounded-t-3xl bg-surface px-5 pt-3 pb-safe sm:rounded-3xl sm:pb-5">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-canvas"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="pb-4">{children}</div>
      </div>
    </dialog>
  );
}

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Used only for destructive or hard-to-undo actions (reversals, cancellations, adjustments). */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  loading,
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-[15px] text-ink-2">{message}</div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" onClick={onClose} disabled={loading}>
          Go back
        </Button>
        <Button variant={tone} size="lg" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
