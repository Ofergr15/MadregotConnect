import { loadPostHog } from '@/lib/analytics/posthog';

// This module runs BEFORE hydration, so nothing heavy may be imported at the top
// level here — see lib/analytics/posthog for why PostHog is fetched instead of
// bundled. Start once the page has finished loading, with a timeout in case
// `load` is very late on a slow connection; loadPostHog() is idempotent, so
// whichever trigger fires first wins and the other is a no-op.
if (typeof window !== 'undefined') {
  const start = () => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) idle(() => void loadPostHog(), { timeout: 2000 });
    else void loadPostHog();
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  window.setTimeout(start, 3000);
}
