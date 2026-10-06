'use client';

// The client half of "view as this person" (lib/auth/view-as.ts). Kept in
// sessionStorage, so closing the tab ends it, and folded into the SWR cache's
// identity (lib/swr-persist.ts), so whatever was fetched as somebody else is
// thrown away on the way in and on the way out instead of being shown later as
// the super user's own.

const KEY = 'mc_view_as_person';

export interface ViewedPerson {
  id: string;
  name: string;
  /** What they are in the academy, for the banner. */
  kind: 'coach' | 'trainee';
}

export function getViewedPerson(): ViewedPerson | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as ViewedPerson) : null;
    return v && typeof v.id === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Start viewing as `person` and reload the academy, so every read is theirs. */
export function startViewingAs(person: ViewedPerson): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(person)); } catch { return; }
  window.location.assign('/dashboard/academy');
}

export function stopViewingAs(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  window.location.assign('/dashboard/academy');
}
