// Which GETs each screen makes, learned as the member uses the app — so a screen's
// data can be fetched BEFORE they open it (components/ScreenPrefetch): in the quiet
// moment after the app opens, and the instant a finger lands on a link. No list to
// keep by hand: a new screen is learned the first time it is opened.
//
// Kept in localStorage per identity (the keys carry athlete ids), at most 30 screens
// × 16 keys, and a key not seen for 7 days drops out (a dated key — this week's plan —
// stops being asked for once the week has moved on).

const STORE = 'mc_screen_keys_v1';
const MAX_SCREENS = 30;
const MAX_KEYS = 16;
const TTL_MS = 7 * 86_400_000;

type Store = { id: string; s: Record<string, { n: number; k: Record<string, number> }> };

function identity(): string {
  try { return localStorage.getItem('athlete_id') || localStorage.getItem('coach_email') || ''; } catch { return ''; }
}

let memo: Store | null = null;
function read(): Store {
  const id = identity();
  if (memo && memo.id === id) return memo;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) || 'null') as Store | null;
    memo = parsed && parsed.id === id ? parsed : { id, s: {} };
  } catch { memo = { id, s: {} }; }
  return memo;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function write() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { if (memo?.id) localStorage.setItem(STORE, JSON.stringify(memo)); } catch { /* full or private */ }
  }, 2000);
}

/** The screen a path belongs to: dynamic segments (ids) folded, so /teammate/<id> is one screen. */
export function screenOf(path: string): string {
  return path.split('?')[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/$/, '') || '/';
}

/** Note that the screen now on display asked for `key`. */
export function recordScreenKey(key: string): void {
  if (typeof window === 'undefined' || !key.startsWith('/api/')) return;
  const st = read();
  if (!st.id) return;
  const screen = screenOf(window.location.pathname);
  const entry = st.s[screen] || (st.s[screen] = { n: 0, k: {} });
  entry.k[key] = Date.now();
  const keys = Object.entries(entry.k).sort((a, b) => b[1] - a[1]);
  if (keys.length > MAX_KEYS) entry.k = Object.fromEntries(keys.slice(0, MAX_KEYS));
  write();
}

/** Count an opened screen (what to warm first after the app opens). */
export function countScreenVisit(path: string): void {
  const st = read();
  if (!st.id) return;
  const screen = screenOf(path);
  const entry = st.s[screen] || (st.s[screen] = { n: 0, k: {} });
  entry.n += 1;
  const all = Object.entries(st.s);
  if (all.length > MAX_SCREENS) st.s = Object.fromEntries(all.sort((a, b) => b[1].n - a[1].n).slice(0, MAX_SCREENS));
  write();
}

/** The keys a screen asked for lately, newest first. */
export function keysForScreen(path: string): string[] {
  const entry = read().s[screenOf(path)];
  if (!entry) return [];
  const cutoff = Date.now() - TTL_MS;
  return Object.entries(entry.k).filter(([, t]) => t > cutoff).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** The member's most opened screens, most first. */
export function topScreens(limit: number): string[] {
  return Object.entries(read().s).sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([s]) => s).filter((s) => !s.includes(':id'));
}

/** Sign-out: forget it all. */
export function clearScreenKeys(): void {
  memo = null;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}
