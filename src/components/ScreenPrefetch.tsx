'use client';

// Fetches a screen's data before it is opened (lib/screen-keys): the member's most
// used screens in the quiet moment after the app is up, and any screen the instant a
// finger lands on a link to it (pointerdown — a tap is ~100 ms of head start, a press
// on a link more). Straight into the app's SWR cache, so the screen paints from it.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { prefetchApi } from '@/lib/api';
import { countScreenVisit, keysForScreen, topScreens } from '@/lib/screen-keys';
import { onAppReady } from '@/lib/app-ready';
import { isViewingPerson } from '@/lib/view-as-person';

/** Ten seconds: a key SWR fetched that recently is not fetched again for a prefetch. */
const FRESH_MS = 10_000;
const fetchedAt = new Map<string, number>();
let warmedTop = false;

export function ScreenPrefetch() {
  const pathname = usePathname();
  const { cache, mutate } = useSWRConfig();

  useEffect(() => { countScreenVisit(pathname); }, [pathname]);

  useEffect(() => {
    const warm = (path: string) => {
      if (isViewingPerson()) return;
      for (const key of keysForScreen(path)) {
        const at = fetchedAt.get(key) ?? 0;
        if (Date.now() - at < FRESH_MS) continue;
        fetchedAt.set(key, Date.now());
        // Into the provider's cache, without a second revalidation on top.
        void mutate(key, prefetchApi(key), { revalidate: false, populateCache: true }).catch(() => {});
      }
    };
    // After the app is up and idle: the most used screens that are not this one.
    let idle = 0;
    const off = onAppReady(() => {
      if (warmedTop) return;
      warmedTop = true;
      const run = () => topScreens(5).filter((s) => s !== pathname).forEach(warm);
      idle = window.setTimeout(() => ('requestIdleCallback' in window ? (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(run) : run()), 1200);
    });
    // A finger on a link: its screen's data starts now.
    const onDown = (e: PointerEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.origin !== window.location.origin) return;
      warm(a.pathname);
    };
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => { off?.(); window.clearTimeout(idle); document.removeEventListener('pointerdown', onDown, { capture: true }); };
    // `cache` is stable per provider; the listener reads the latest keys each time.
  }, [pathname, mutate, cache]);

  return null;
}
