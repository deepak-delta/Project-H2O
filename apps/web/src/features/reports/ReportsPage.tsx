import { Boxes, CalendarDays, CalendarRange, HandCoins, Receipt, Store, Wallet, type LucideIcon } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { ListCard, ListRow } from '../../components/ui/Card';

const REPORTS: { to: string; title: string; subtitle: string; icon: LucideIcon }[] = [
  { to: '/reports/sales', title: 'Daily sales', subtitle: 'Sales, collections and cans per day', icon: CalendarDays },
  { to: '/reports/sales?groupBy=month', title: 'Monthly sales', subtitle: 'The last 12 months at a glance', icon: CalendarRange },
  { to: '/reports/outstanding', title: 'Who owes money', subtitle: 'Outstanding credit by store', icon: HandCoins },
  { to: '/inventory/holders', title: 'Cans with stores', subtitle: 'Which stores have your cans', icon: Store },
  { to: '/reports/inventory', title: 'Stock movement', subtitle: 'Opening, in, out and closing stock', icon: Boxes },
  { to: '/reports/payments', title: 'Payments received', subtitle: 'Every payment, for your records', icon: Wallet },
  { to: '/cashflow', title: 'Cash flow & expenses', subtitle: 'Money in and out by category', icon: Receipt },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" back="/more" />
      <PageBody>
        <ListCard>
          {REPORTS.map(({ to, title, subtitle, icon: Icon }) => (
            <ListRow key={to} to={to} title={title} subtitle={subtitle} leading={<Icon className="size-5 text-brand-700" aria-hidden />} />
          ))}
        </ListCard>
        <p className="px-1 text-sm text-muted">Every report can be downloaded as a CSV file for Excel or Google Sheets.</p>
      </PageBody>
    </>
  );
}
