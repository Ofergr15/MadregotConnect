import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import type { StoryFeature } from '@/lib/stories/gate';

export interface StoryAccess { allowed: boolean; tester: boolean; preview: boolean; viewingAs?: boolean }

/** The בבדיקה badge + משוב: testers only, and never while an admin views as them
 *  (their feedback would be filed under the tester's name). */
export function showTesterBar(a: StoryAccess | null | undefined): boolean {
  return !!a?.allowed && a.tester && !a.viewingAs;
}

const CLOSED: StoryAccess = { allowed: false, tester: false, preview: false };

/** Asks the server gate (/api/stories/<feature>). Anything but a clean 200 = closed. */
export async function fetchStoryAccess(feature: StoryFeature): Promise<StoryAccess> {
  try {
    const res = await fetch(`/api/stories/${feature}`, { headers: await apiHeaders() });
    if (!res.ok) return CLOSED;
    const d = await res.json();
    return d?.allowed === true ? { allowed: true, tester: !!d.tester, preview: !!d.preview, viewingAs: !!d.viewingAs } : CLOSED;
  } catch {
    return CLOSED;
  }
}

/**
 * The gate as a hook, for every entry into the week share sheet / week story. `null`
 * while asking, then the server's answer; closed on any failure. One request per page.
 */
const cache = new Map<StoryFeature, Promise<StoryAccess>>();
export function useStoryAccess(feature: StoryFeature): StoryAccess | null {
  const [access, setAccess] = useState<StoryAccess | null>(null);
  useEffect(() => {
    let live = true;
    let p = cache.get(feature);
    if (!p) {
      p = fetchStoryAccess(feature);
      cache.set(feature, p);
      // Re-ask on the next mount after a while, so a removed tester loses it on the next read.
      p.finally(() => setTimeout(() => cache.delete(feature), 30_000));
    }
    p.then((a) => { if (live) setAccess(a); });
    return () => { live = false; };
  }, [feature]);
  return access;
}
