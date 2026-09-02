'use client';

import { getSupabase } from '@/lib/supabase/client';

/**
 * Re-mints the Supabase session for a browser that already completed a real
 * login but has since lost it — see /api/auth/silent-session for why that
 * happens routinely rather than exceptionally.
 *
 * This lived privately inside feed-client.ts, which meant only the feed
 * self-healed: every other bearer-gated route just 401'd. It's shared now
 * because bearer-headers.ts calls it too, so migrating a route off the
 * forgeable x-user-email header can't cost an athlete their screen.
 *
 * Best-effort by contract: returns null on any failure and the caller falls
 * back to its own unauthenticated behaviour.
 */

// createSyntheticSession rotates the underlying auth user's password on every
// call — two concurrent callers (two feed components mounting together, React
// Strict Mode's double-invoke, or now several SWR fetchers firing at once on a
// page load) race on that rotation and one signs in with a stale password.
// Sharing one in-flight promise across concurrent calls avoids that, and
// sharing it at MODULE scope means the feed and bearer-headers can't race each
// other either — which they could when each held its own copy.
let inFlight: Promise<string | null> | null = null;

// Once the device cookie is known-absent (a signed-out visitor on the public
// landing page, or a browser that never logged in), nothing about this page
// load will change that. Without the latch every SWR fetch on the page fires
// its own POST that can only 401.
let hopeless = false;

export async function trySilentReauth(): Promise<string | null> {
  if (hopeless) return null;
  if (inFlight) return inFlight;
  const run = async (): Promise<string | null> => {
    try {
      // No body: the route takes the identity from its signed httpOnly device
      // cookie, never from what the client claims. Returns 401 on a browser
      // that never completed a real login, and the caller falls back.
      const res = await fetch('/api/auth/silent-session', { method: 'POST' });
      if (!res.ok) {
        // 401 means "this browser holds no proof it ever logged in" — a stable
        // fact. A 5xx is transient, so leave the door open to retry.
        if (res.status === 401) hopeless = true;
        return null;
      }
      const { session } = await res.json();
      if (!session?.access_token || !session?.refresh_token) return null;
      const { data, error } = await getSupabase().auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) return null;
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  };
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Lets a real login clear the give-up latch without a page reload. */
export function resetSilentReauth(): void {
  hopeless = false;
  inFlight = null;
}
