import { useEffect, type ReactNode } from 'react';
import { trackEvent, flushEvents } from '@/lib/track';

/**
 * Root tracking host. Installs:
 *  - a delegated click handler that reads `data-track="<name>"` from the
 *    closest matching element and emits a `click` event
 *  - a `pagehide` flush so the last few events make it out via sendBeacon
 */
export function TrackingRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    function onClick(ev: MouseEvent) {
      const target = ev.target as HTMLElement | null;
      const el = target?.closest?.('[data-track]') as HTMLElement | null;
      if (!el) return;
      const name = el.getAttribute('data-track');
      if (!name) return;
      const category = el.getAttribute('data-track-category') || 'click';
      let props: Record<string, unknown> | undefined;
      const raw = el.getAttribute('data-track-props');
      if (raw) {
        try { props = JSON.parse(raw); } catch { /* ignore */ }
      }
      trackEvent(name, props, category);
    }
    function onHide() { void flushEvents(true); }

    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  return <>{children}</>;
}
