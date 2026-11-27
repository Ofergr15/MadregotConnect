'use client';

// Client-side read of GET /api/features/me for the WEB app. One request per page
// load, shared by every caller (module-level promise). Fails closed: any error,
// signed-out caller or unknown key reads as OFF — a flag is a rollout gate, so
// "couldn't tell" must look exactly like "not enabled".

import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import type { FeatureKey } from '@/lib/features/flags';

let pending: Promise<Record<string, boolean>> | null = null;

export function loadFeatures(): Promise<Record<string, boolean>> {
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch('/api/features/me', { headers: await apiHeaders(), cache: 'no-store' });
        if (!res.ok) return {};
        const body = (await res.json()) as { features?: Record<string, boolean> };
        return body.features ?? {};
      } catch {
        // Fail closed (see header) — nothing to report; the flag simply stays off.
        return {};
      }
    })();
  }
  return pending;
}

/** Test hook: forget the cached response. */
export function resetFeatureCache(): void {
  pending = null;
}

export function useFeature(key: FeatureKey): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadFeatures().then((f) => { if (alive) setOn(f[key] === true); });
    return () => { alive = false; };
  }, [key]);
  return on;
}
