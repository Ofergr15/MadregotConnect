// Practice mode: while a tour runs, NOTHING is written (Ofer: the practice workout reaches
// nobody). Every non-GET request to our API is answered here instead of reaching the
// server — no plan, no Garmin, no push, no chat line — except the tour's own "seen" flag.
// The day-plan send gets a believable answer, so the real send screen shows; it says
// "תרגול — לא נשלח" (SendScreen, via isPracticeActive()).

const ALLOW = ['/api/tours'];

let original: typeof fetch | null = null;
let active = false;

export function isPracticeActive(): boolean {
  return active;
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try { return new URL(raw, 'http://local').pathname; } catch { return raw; }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET') || 'GET').toUpperCase();
}

/** The request the guard would hold back, and what it answers instead (exported for tests). */
export function practiceAnswer(path: string, method: string, body: unknown): Response | null {
  if (method === 'GET' || method === 'HEAD' || !path.startsWith('/api/')) return null;
  if (ALLOW.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  if (path === '/api/academy/day-plan') {
    const b = (body && typeof body === 'object' ? body : {}) as { recipients?: string[] };
    const results = (b.recipients ?? []).map((athleteId) => ({ athleteId, name: '', status: 'saved', reason: 'practice', practice: true }));
    return new Response(JSON.stringify({ ok: true, practice: true, results }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true, practice: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export function startPractice(): void {
  if (active || typeof window === 'undefined') return;
  active = true;
  original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init);
    let body: unknown = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = null; } }
    const held = practiceAnswer(pathOf(input), method, body);
    if (held) return held;
    return original!(input, init);
  };
}

export function stopPractice(): void {
  if (!active || typeof window === 'undefined') return;
  active = false;
  if (original) window.fetch = original;
  original = null;
}
