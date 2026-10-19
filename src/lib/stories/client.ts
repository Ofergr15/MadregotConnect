import { apiHeaders } from '@/lib/api';
import type { StoryFeature } from '@/lib/stories/gate';

export interface StoryAccess { allowed: boolean; tester: boolean; preview: boolean }

const CLOSED: StoryAccess = { allowed: false, tester: false, preview: false };

/** Asks the server gate (/api/stories/<feature>). Anything but a clean 200 = closed. */
export async function fetchStoryAccess(feature: StoryFeature): Promise<StoryAccess> {
  try {
    const res = await fetch(`/api/stories/${feature}`, { headers: await apiHeaders() });
    if (!res.ok) return CLOSED;
    const d = await res.json();
    return d?.allowed === true ? { allowed: true, tester: !!d.tester, preview: !!d.preview } : CLOSED;
  } catch {
    return CLOSED;
  }
}
