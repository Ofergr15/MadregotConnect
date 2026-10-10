'use client';

import { getSupabase } from '@/lib/supabase/client';
import { detectInstallPlatform } from '@/lib/install/platform';
import { isStandalone } from '@/lib/pwa';
import type { OnbStep } from '@/lib/onboarding/events';

/**
 * Report a joining step from the browser (lib/onboarding/events.ts). Fire and
 * forget: it never throws and never delays the screen. `token` identifies the
 * member before they have a session (the /join and /welcome pages).
 */
export function trackOnb(step: OnbStep, opts: { token?: string | null; meta?: Record<string, unknown>; once?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  // `once`: a view, counted once per tab session however often the screen re-renders.
  if (opts.once) {
    try {
      const k = `mc-onb:${step}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch { /* private mode: count it */ }
  }
  (async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    } catch { /* not signed in yet: the token says who */ }
    let platform: string | undefined;
    let standalone = false;
    try { platform = detectInstallPlatform(); standalone = isStandalone(); } catch { /* ignore */ }
    await fetch('/api/onboarding/event', {
      method: 'POST', headers, keepalive: true,
      body: JSON.stringify({ step, token: opts.token ?? undefined, platform, standalone, meta: opts.meta }),
    });
  })().catch(() => {});
}
