import { Download } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="ghost" icon={<Download className="size-5" />} onClick={onClick} disabled={disabled} aria-label="Download CSV">
      CSV
    </Button>
  );
}

/** "1 Oct 2026" or "Oct 2026" for report periods (keys are already local dates). */
export function formatPeriod(period: string): string {
  const [y, m, d] = period.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    ...(d ? { day: 'numeric', weekday: 'short' } : {}),
    month: 'short',
    year: 'numeric',
  }).format(date);
}
