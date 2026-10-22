import { mapsUrl } from '@wd/shared';
import { MapPin, Navigation } from 'lucide-react';
import { Card } from '../../components/ui/Card';

/**
 * Where the client is: the written address and an "Open in Maps" button (the saved map link,
 * else a Maps search for the address). Nothing is shown when neither is known.
 */
export function Destination({ address, mapLink, className }: { address: string | null; mapLink: string | null; className?: string }) {
  const url = mapsUrl({ address, mapLink });
  if (!url) return null;
  return (
    <Card className={`flex items-center gap-3 p-3 pl-4 ${className ?? ''}`}>
      <MapPin className="size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted">Deliver to</p>
        <p className="break-words text-[15px] text-ink">{address || 'Location saved on the map'}</p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-[15px] font-semibold text-brand-700 hover:bg-canvas"
      >
        <Navigation className="size-4" aria-hidden />
        Open in Maps
      </a>
    </Card>
  );
}
