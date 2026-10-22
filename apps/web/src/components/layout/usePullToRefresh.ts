import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type RefObject } from 'react';

/** How far (px, after damping) the screen must be pulled to refresh. */
export const PULL_TRIGGER = 64;
const PULL_MAX = 96;
/** The spinner stays at least this long, so a fast refresh still reads as "done". */
const MIN_SPIN_MS = 500;

/** True when the touch began inside something already scrolled, or in a sheet. */
function insideScrolled(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.tagName === 'DIALOG' || el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Pull down at the top of a screen to refetch everything on it, as in other phone apps. Touch
 * only; listeners are passive, so normal scrolling is never held up.
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>): { pull: number; refreshing: boolean } {
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let start: { x: number; y: number } | null = null;
    let distance = 0;
    let busy = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = !busy && e.touches.length === 1 && t && root.scrollTop <= 0 && !insideScrolled(e.target, root) ? { x: t.clientX, y: t.clientY } : null;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dy = t.clientY - start.y;
      const dx = Math.abs(t.clientX - start.x);
      // Scrolling up, sideways swipes, or the list moved: not a pull.
      if (dy <= 0 || dx > dy || root.scrollTop > 0) {
        start = null;
        distance = 0;
        setPull(0);
        return;
      }
      distance = Math.min(dy * 0.5, PULL_MAX);
      setPull(distance);
    };
    const onEnd = () => {
      const pulled = start !== null && distance >= PULL_TRIGGER;
      start = null;
      distance = 0;
      setPull(0);
      if (!pulled) return;
      busy = true;
      setRefreshing(true);
      const began = Date.now();
      void queryClient
        .refetchQueries({ type: 'active' })
        .catch(() => undefined)
        .finally(() => {
          window.setTimeout(() => {
            busy = false;
            setRefreshing(false);
          }, Math.max(0, MIN_SPIN_MS - (Date.now() - began)));
        });
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: true });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller, queryClient]);

  return { pull, refreshing };
}
