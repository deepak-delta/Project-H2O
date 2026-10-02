import { formatPhone } from '@wd/shared';
import { ChartColumn, Package, Receipt, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import { PageBody, PageHeader } from '../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../components/ui/Card';
import { LogoutButton } from '../features/auth/LogoutButton';
import { useSession } from '../features/auth/session';

interface MoreLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const BUSINESS_LINKS: MoreLink[] = [
  { to: '/reports', label: 'Reports', icon: ChartColumn },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { to: '/cashflow', label: 'Cash flow & expenses', icon: Receipt },
  { to: '/products', label: 'Products & prices', icon: Package },
];

export default function MorePage() {
  const { user, business } = useSession();

  return (
    <>
      <PageHeader title="More" />
      <PageBody>
        <Card className="px-4 py-3.5">
          <p className="font-semibold text-ink">{business.businessName}</p>
          <p className="text-sm text-muted">
            {user.name} · {formatPhone(user.phone)}
          </p>
        </Card>
        <ListCard>
          {BUSINESS_LINKS.map(({ to, label, icon: Icon }) => (
            <ListRow key={to} to={to} title={label} leading={<Icon className="size-5 text-brand-700" aria-hidden />} />
          ))}
        </ListCard>
        <ListCard>
          <ListRow
            to="/settings/security"
            title="Login & security"
            subtitle="PIN, Face ID / fingerprint"
            leading={<ShieldCheck className="size-5 text-brand-700" aria-hidden />}
          />
        </ListCard>
        <LogoutButton />
      </PageBody>
    </>
  );
}
