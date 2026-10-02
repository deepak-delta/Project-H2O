import { useEffect, useState } from 'react';
import { useOnline } from './useOnline';

/**
 * True when we're offline and something has been "loading" for a moment — i.e. the data was
 * never saved on this phone, so it won't arrive until the connection is back.
 * The short delay avoids flashing the message while cached code or data loads.
 */
export function useOfflineStall(delayMs = 1200): boolean {
  const online = useOnline();
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (online) return;
    const id = window.setTimeout(() => setStalled(true), delayMs);
    // Reset when the connection returns, so the next offline spell gets the delay again.
    return () => {
      window.clearTimeout(id);
      setStalled(false);
    };
  }, [online, delayMs]);
  return !online && stalled;
}
