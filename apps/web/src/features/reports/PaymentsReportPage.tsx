import { fromMinor, toMinor } from '@wd/shared';
import { Wallet } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PeriodChips, usePeriod } from '../../components/ui/PeriodPicker';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useMoney, useTimezone } from '../../hooks/useMoney';
import { errorMessage } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { formatDateTime } from '../../utils/format';
import { METHOD_LABEL } from '../cashflow/labels';
import { usePaymentsReport } from './api';
import { CsvButton } from './ReportBits';

export default function PaymentsReportPage() {
  const { period, setPreset, allowed } = usePeriod('today');
  const report = usePaymentsReport(period.from, period.to);
  const format = useMoney();
  const tz = useTimezone();
  const rows = report.data?.rows ?? [];
  const totalMinor = rows.filter((r) => !r.reversed).reduce((s, r) => s + toMinor(r.amount), 0);

  const exportCsv = () =>
    downloadCsv(
      `payments-${period.from}-to-${period.to}.csv`,
      ['Date', 'Store', 'Method', 'Amount', 'Order', 'Reference', 'Reversed'],
      rows.map((r) => [
        formatDateTime(r.paymentDate, tz),
        r.storeName,
        METHOD_LABEL[r.method],
        r.amount,
        r.orderNumber ? `#${r.orderNumber}` : '',
        r.referenceNumber ?? '',
        r.reversed ? 'Yes' : '',
      ]),
    );

  return (
    <>
      <PageHeader title="Payments received" back="/reports" action={<CsvButton onClick={exportCsv} disabled={rows.length === 0} />} />
      <PageBody>
        <PeriodChips value={period.preset} onChange={setPreset} allowed={allowed} />
        {report.isPending ? (
          <ListSkeleton rows={6} />
        ) : report.isError ? (
          <ErrorRetry message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Wallet className="size-6" />} title="No payments in this period" />
        ) : (
          <>
            <Card className="px-4 py-3.5">
              <p className="text-[13px] text-muted">Received · {period.label}</p>
              <p className="text-2xl font-semibold text-ok tabular">{format(fromMinor(totalMinor))}</p>
              <p className="text-sm text-muted">
                {rows.length} payment{rows.length === 1 ? '' : 's'}
                {report.data.truncated ? ' · showing the first 5,000; choose a shorter period' : ''}
              </p>
            </Card>
            <ListCard>
              {[...rows].reverse().map((p) => (
                <ListRow
                  key={p.id}
                  to={`/stores/${p.storeId}`}
                  title={p.storeName}
                  subtitle={[METHOD_LABEL[p.method], p.referenceNumber, formatDateTime(p.paymentDate, tz)].filter(Boolean).join(' · ')}
                  trailing={
                    <span className="flex flex-col items-end gap-1">
                      <span className={`font-semibold tabular ${p.reversed ? 'text-muted line-through' : 'text-ok'}`}>{format(p.amount)}</span>
                      {p.reversed ? <Badge>Reversed</Badge> : null}
                    </span>
                  }
                />
              ))}
            </ListCard>
          </>
        )}
      </PageBody>
    </>
  );
}

