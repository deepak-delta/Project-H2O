import { WifiOff } from 'lucide-react';
import { EmptyState } from './EmptyState';

export function NotSavedOffline() {
  return (
    <EmptyState
      icon={<WifiOff className="size-6" />}
      title="Not available offline"
      description="This hasn't been saved on this phone yet. It will load when you're back online."
    />
  );
}
