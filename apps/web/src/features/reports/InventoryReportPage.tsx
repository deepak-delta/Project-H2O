import type { StockCounts } from '@wd/shared';
import { Boxes } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorRetry } from '../../components/ui/LoadMore';
import { PeriodChips, usePeriod } from '../../components/ui/PeriodPicker';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { errorMessage } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { MOVEMENT_LABEL } from '../inventory/InventoryPage';
import { useInventoryReport } from './api';
import { CsvButton } from './ReportBits';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '·');

function Line({ label, c, strong }: { label: string; c: StockCounts; strong?: boolean }) {
  const cell = (n: number) => <td className={`py-1.5 text-right tabular ${n === 0 && !strong ? 'text-muted' : ''}`}>{strong ? n : signed(n)}</td>;
  return (
    <tr className={strong ? 'font-semibold text-ink' : 'text-ink-2'}>
      <th scope="row" className="py-1.5 pr-2 text-left font-[inherit]">
        {label}
      </th>
      {cell(c.filled)}
      {cell(c.empty)}
      {cell(c.withCustomers)}
      {cell(c.damaged)}
    </tr>
  );
}

/** Opening + every kind of movement = closing, per product. */
export default function InventoryReportPage() {
  const { period, setPreset, allowed } = usePeriod('7d');
  const report = useInventoryReport(period.from, period.to);

  const exportCsv = () =>
    report.data &&
    downloadCsv(
      `stock-${period.from}-to-${period.to}.csv`,
      ['Product', 'Line', 'Filled', 'Empty', 'With stores', 'Damaged'],
      report.data.products.flatMap((p) => [
        [p.productName, 'Opening', p.opening.filled, p.opening.empty, p.opening.withCustomers, p.opening.damaged],
        ...p.movements.map((m) => [p.productName, MOVEMENT_LABEL[m.type], m.filled, m.empty, m.withCustomers, m.damaged]),
        [p.productName, 'Closing', p.closing.filled, p.closing.empty, p.closing.withCustomers, p.closing.damaged],
      ]),
    );

  return (
    <>
      <PageHeader title="Stock movement" back="/reports" action={<CsvButton onClick={exportCsv} disabled={!report.data} />} />
      <PageBody>
        <PeriodChips value={period.preset} onChange={setPreset} allowed={allowed} />
        {report.isPending ? (
          <ListSkeleton rows={4} />
        ) : report.isError ? (
          <ErrorRetry message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
        ) : report.data.products.length === 0 ? (
          <EmptyState icon={<Boxes className="size-6" />} title="No stock recorded yet" />
        ) : (
          report.data.products.map((p) => (
            <Card key={p.productId} className="overflow-x-auto p-4">
              <p className="mb-2 font-semibold text-ink">{p.productName}</p>
              <table className="w-full min-w-[18rem] text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="pb-1 text-left font-medium">
                      {period.label}
                    </th>
                    <th scope="col" className="pb-1 text-right font-medium">Filled</th>
                    <th scope="col" className="pb-1 text-right font-medium">Empty</th>
                    <th scope="col" className="pb-1 text-right font-medium">Stores</th>
                    <th scope="col" className="pb-1 text-right font-medium">Damaged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <Line label="Opening" c={p.opening} strong />
                  {p.movements.map((m) => (
                    <Line key={m.type} label={MOVEMENT_LABEL[m.type]} c={m} />
                  ))}
                  <Line label="Closing" c={p.closing} strong />
                </tbody>
              </table>
            </Card>
          ))
        )}
      </PageBody>
    </>
  );
}
