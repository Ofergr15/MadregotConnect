// Where "this person has seen the tour" lives: athletes.notification_prefs.tours (JSON, no
// migration — the same column the feed's hidden runs use). The client also keeps a local
// copy, so the answer holds while an admin is viewing somebody (writes are refused then)
// and before the server has answered.

export interface TourPrefs {
  /** tour id → how it ended ('done' | 'later' | 'skipped'). */
  tours: Record<string, string>;
  /** hotspot key → dismissed. */
  hotspots: Record<string, true>;
}

export const EMPTY_PREFS: TourPrefs = { tours: {}, hotspots: {} };

const TOUR_END = new Set(['done', 'later', 'skipped']);
const KEY = /^[a-z0-9-]{1,40}$/;

/** The stored JSON, cleaned: only known end states and well-formed keys survive. */
export function readTourPrefs(prefs: unknown): TourPrefs {
  const raw = (prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>).tourPrefs : null) as Record<string, unknown> | null;
  const out: TourPrefs = { tours: {}, hotspots: {} };
  if (!raw || typeof raw !== 'object') return out;
  const tours = raw.tours && typeof raw.tours === 'object' ? (raw.tours as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(tours)) if (KEY.test(k) && typeof v === 'string' && TOUR_END.has(v)) out.tours[k] = v;
  const spots = raw.hotspots && typeof raw.hotspots === 'object' ? (raw.hotspots as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(spots)) if (KEY.test(k) && v === true) out.hotspots[k] = true;
  return out;
}

/** The change one POST makes, merged into the existing prefs (every other key kept). */
export function applyTourChange(prefs: unknown, change: { tour?: string; state?: string; hotspot?: string; reset?: string }): Record<string, unknown> | null {
  const base = (prefs && typeof prefs === 'object' ? prefs : {}) as Record<string, unknown>;
  const cur = readTourPrefs(base);
  if (change.tour && KEY.test(change.tour) && change.state && TOUR_END.has(change.state)) cur.tours[change.tour] = change.state;
  else if (change.hotspot && KEY.test(change.hotspot)) cur.hotspots[change.hotspot] = true;
  else if (change.reset && KEY.test(change.reset)) delete cur.tours[change.reset];
  else return null;
  return { ...base, tourPrefs: cur };
}

export const LOCAL_KEY = 'mc-tour-prefs';

export function readLocal(): TourPrefs {
  if (typeof window === 'undefined') return EMPTY_PREFS;
  try { return readTourPrefs({ tourPrefs: JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }); } catch { return EMPTY_PREFS; }
}

export function writeLocal(p: TourPrefs): void {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Server and local, merged: seen on either means seen. */
export function mergePrefs(a: TourPrefs, b: TourPrefs): TourPrefs {
  return { tours: { ...a.tours, ...b.tours }, hotspots: { ...a.hotspots, ...b.hotspots } };
}
