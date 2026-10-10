import { describe, expect, it, vi, beforeEach } from 'vitest';

// The client half of "view as this person" (lib/view-as-person.ts): while viewing,
// the device's identity keys read as the viewed person and cannot be overwritten,
// every /api/ request carries the header, and no write leaves the browser — a
// tapped one raises the read-only toast, a background one is dropped silently.
//
// Node has no DOM here, so the few browser globals the module touches are stood up
// by hand before it is imported (it installs itself at import time).

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
const local = new FakeStorage();
const session = new FakeStorage();
const sent: Array<{ url: string; method: string; headers: Headers }> = [];
const events: string[] = [];
const nativeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  sent.push({ url: String(input), method: init?.method || 'GET', headers: new Headers(init?.headers) });
  return new Response('{}', { status: 200 });
});
const assigned: string[] = [];

vi.stubGlobal('Storage', FakeStorage);
vi.stubGlobal('window', {
  localStorage: local,
  sessionStorage: session,
  location: { href: 'https://madregot.app/dashboard/academy', origin: 'https://madregot.app', pathname: '/dashboard/academy', search: '', assign: (u: string) => assigned.push(u) },
  fetch: nativeFetch,
  dispatchEvent: (e: Event) => { events.push(e.type); return true; },
});

const mod = await import('@/lib/view-as-person');
const { startViewingAs, stopViewingAs, getViewedPerson, viewAsWriteDisposition, readRecentPeople, clearViewedPerson } = mod;
const w = globalThis.window as unknown as { fetch: typeof fetch };

const SHAHAR = { id: '00000000-0000-4000-8000-00000000005a', name: 'Shahar Glazner', tag: 'trainee' as const, email: 'shahar@x.com', groupId: 'g3' };

beforeEach(() => {
  sent.length = 0; events.length = 0; assigned.length = 0;
  clearViewedPerson();
  local.setItem('athlete_id', 'ADMIN-ID');
  local.setItem('athlete_name', 'Ofer');
  local.setItem('coach_email', 'ofer@x.com');
  local.setItem('view_as_role', 'coach');
});

describe('view as a person, on the device', () => {
  it('reads the identity keys as the viewed person, and gives them back on exit', () => {
    startViewingAs(SHAHAR);
    expect(assigned).toEqual(['/feed']);
    expect(local.getItem('athlete_id')).toBe(SHAHAR.id);
    expect(local.getItem('athlete_name')).toBe('Shahar Glazner');
    expect(local.getItem('athlete_email')).toBe('shahar@x.com');
    expect(local.getItem('athlete_group_id')).toBe('g3');
    // The admin's staff flag and view switch do not leak into somebody else's app.
    expect(local.getItem('coach_email')).toBeNull();
    // Writes to them are dropped: nothing can overwrite the real identity.
    local.setItem('athlete_id', 'SOMEONE');
    local.removeItem('athlete_name');
    // Other keys are untouched.
    local.setItem('plan_view', 'week');
    expect(local.getItem('plan_view')).toBe('week');

    stopViewingAs();
    expect(assigned.at(-1)).toBe('/dashboard/academy');
    expect(getViewedPerson()).toBeNull();
    expect(local.getItem('athlete_id')).toBe('ADMIN-ID');
    expect(local.getItem('athlete_name')).toBe('Ofer');
    expect(local.getItem('coach_email')).toBe('ofer@x.com');
    // Starting a person view ends a role preview, so its role is not drawn over them.
    expect(local.getItem('view_as_role')).toBeNull();
  });

  it('remembers recents, newest first, without duplicates', () => {
    startViewingAs(SHAHAR);
    startViewingAs({ ...SHAHAR, id: '00000000-0000-4000-8000-0000000000aa', name: 'Sahar Azar', tag: 'academy_coach' });
    startViewingAs(SHAHAR);
    expect(readRecentPeople().map((p) => p.name)).toEqual(['Shahar Glazner', 'Sahar Azar']);
  });

  it('sends the header on every /api/ read, including hand-built fetches', async () => {
    startViewingAs(SHAHAR);
    await w.fetch('/api/feed', { headers: { Authorization: 'Bearer t' } });
    expect(sent[0].headers.get('x-view-as')).toBe(SHAHAR.id);
    expect(sent[0].headers.get('authorization')).toBe('Bearer t');
    await w.fetch('https://other.example/api/x');
    expect(sent[1].headers.get('x-view-as')).toBeNull();
  });

  it('keeps every write in the browser: a tapped one toasts, a background one is silent', async () => {
    startViewingAs(SHAHAR);
    const tapped = await w.fetch('/api/workout-feedback/f1/messages', { method: 'POST', body: '{}' });
    expect(tapped.status).toBe(403);
    expect(await tapped.json()).toEqual({ error: 'view_as_read_only' });
    expect(events).toEqual(['view-as-blocked']);

    events.length = 0;
    for (const path of ['/api/push/subscribe', '/api/client-events', '/api/strava/sync-activities', '/api/run-chat/token', '/api/academy/threads']) {
      expect((await w.fetch(path, { method: 'POST' })).status).toBe(403);
    }
    expect(events).toEqual([]);
    expect(sent).toEqual([]);

    // The admin's own session doors still work: silent re-auth, sign-out.
    await w.fetch('/api/auth/silent-session', { method: 'POST' });
    expect(sent).toHaveLength(1);
  });

  it('does nothing at all when nobody is being viewed', async () => {
    await w.fetch('/api/feed/like', { method: 'POST' });
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get('x-view-as')).toBeNull();
    expect(local.getItem('athlete_id')).toBe('ADMIN-ID');
  });

  it('classifies writes', () => {
    expect(viewAsWriteDisposition('/api/feed', 'GET')).toBe('send');
    expect(viewAsWriteDisposition('/api/auth/me', 'POST')).toBe('toast');
    expect(viewAsWriteDisposition('/api/auth/sign-out', 'POST')).toBe('send');
    expect(viewAsWriteDisposition('/api/academy/threads/messages', 'POST')).toBe('toast');
    expect(viewAsWriteDisposition('/api/academy/threads', 'POST')).toBe('silent');
    expect(viewAsWriteDisposition('/api/push/unsubscribe', 'POST')).toBe('silent');
    expect(viewAsWriteDisposition('/api/garmin/push-workouts', 'POST')).toBe('toast');
  });
});
