import { FileText, Lock } from 'lucide-react';
import { ListCard, ListRow } from '../../components/ui/Card';

/** "Privacy policy" and "Terms and conditions" rows for More / Account. */
export function LegalMenu() {
  return (
    <ListCard>
      <ListRow to="/privacy" title="Privacy policy" leading={<Lock className="size-5 text-brand-700" aria-hidden />} />
      <ListRow to="/terms" title="Terms and conditions" leading={<FileText className="size-5 text-brand-700" aria-hidden />} />
    </ListCard>
  );
}
