import { formatPhone } from '@wd/shared';
import { Bell, ShieldCheck } from 'lucide-react';
import { PageBody, PageHeader } from '../../components/layout/PageHeader';
import { Card, ListCard, ListRow } from '../../components/ui/Card';
import { LogoutButton } from '../../features/auth/LogoutButton';
import { LegalMenu } from '../../features/legal/LegalMenu';
import { useSession } from '../../features/auth/session';

export default function AccountPage() {
  const { user, store, business } = useSession();
  return (
    <>
      <PageHeader title="Account" />
      <PageBody>
        <Card className="px-4 py-3.5">
          <p className="font-semibold text-ink">{store?.name ?? user.name}</p>
          <p className="text-sm text-muted">{formatPhone(user.phone)}</p>
          <p className="mt-2 text-sm text-muted">Supplier: {business.businessName}</p>
        </Card>
        <ListCard>
          <ListRow
            to="/settings/notifications"
            title="Notifications"
            subtitle="Orders, deliveries and payments"
            leading={<Bell className="size-5 text-brand-700" aria-hidden />}
          />
          <ListRow
            to="/settings/security"
            title="Login & security"
            subtitle="PIN, Face ID / fingerprint"
            leading={<ShieldCheck className="size-5 text-brand-700" aria-hidden />}
          />
        </ListCard>
        <LegalMenu />
        <LogoutButton />
      </PageBody>
    </>
  );
}
