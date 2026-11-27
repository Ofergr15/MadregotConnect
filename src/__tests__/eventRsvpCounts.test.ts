import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { rsvpDecision, promotionsFor } from '@/lib/events/rsvp';

let me = 'a1';
vi.mock('@/lib/auth-session', () => ({
  requireAthlete: async () => ({ ok: true, user: { athleteId: me, isStaff: false } }),
  authError: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/events/lifecycle', () => ({ isVisibleTo: () => true }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const reg = await import('@/app/api/events/[id]/register/route');
const { rebalanceWaitlist } = await import('@/lib/events/rsvp-server');

const ctx = { params: Promise.resolve({ id: 'e1' }) };
const rsvp = async (who: string) => { me = who; return (await reg.POST(new Request('http://x', { method: 'POST' }), ctx)).json(); };
const cancel = async (who: string) => { me = who; return (await reg.DELETE(new Request('http://x', { method: 'DELETE' }), ctx)).json(); };
const statusOf = (who: string) => db.tables.event_registrations.find((r) => r.athlete_id === who)?.status;
const tick = () => new Promise((r) => setTimeout(r, 2));

function seed(capacity: number | null) {
  db = createMemoryDb({ schema: { events: ['id', 'capacity'], event_registrations: ['id', 'event_id', 'athlete_id', 'status', 'created_at'] } });
  db.tables.events.push({ id: 'e1', capacity });
}

describe('rsvp rules', () => {
  it('a repeat RSVP is a no-op', () => {
    expect(rsvpDecision({ id: 'r', status: 'registered' }, 5, 5)).toEqual({ action: 'noop', status: 'registered' });
    expect(rsvpDecision({ id: 'r', status: 'waitlisted' }, 5, 5)).toEqual({ action: 'noop', status: 'waitlisted' });
  });
  it('a waitlisted member moves up in place when there is room', () => {
    expect(rsvpDecision({ id: 'r', status: 'waitlisted' }, 4, 5)).toEqual({ action: 'promote', status: 'registered' });
  });
  it('a cancelled member coming back rejoins at the back', () => {
    expect(rsvpDecision({ id: 'r', status: 'cancelled' }, 5, 5)).toMatchObject({ action: 'write', status: 'waitlisted', refreshQueuePosition: true });
  });
  it('promotions fill free spots, all of them with no capacity, never negative', () => {
    const w = [{ id: '1' }, { id: '2' }, { id: '3' }];
    expect(promotionsFor(5, 3, w)).toEqual(['1', '2']);
    expect(promotionsFor(null, 3, w)).toEqual(['1', '2', '3']);
    expect(promotionsFor(2, 5, w)).toEqual([]);
  });
});

describe("who's coming — across RSVPs, repeats, cancels and edits", () => {
  beforeEach(() => seed(2));

  it('double RSVP counts once', async () => {
    await rsvp('a1');
    const b = await rsvp('a1');
    expect(b.registeredCount).toBe(1);
    expect(db.tables.event_registrations).toHaveLength(1);
  });

  it('a waitlisted repeat keeps their place in line', async () => {
    await rsvp('a1'); await rsvp('a2'); await tick();
    await rsvp('w1'); await tick();
    await rsvp('w2'); await tick();
    const before = db.tables.event_registrations.find((r) => r.athlete_id === 'w1')!.created_at;
    await rsvp('w1');
    expect(db.tables.event_registrations.find((r) => r.athlete_id === 'w1')!.created_at).toBe(before);
    const s = await cancel('a1');
    expect(s.promotedAthleteId).toBe('w1');
    expect(statusOf('w2')).toBe('waitlisted');
    expect(s.registeredCount).toBe(2);
    expect(s.waitlistCount).toBe(1);
  });

  it('cancelling a waitlisted row frees nothing', async () => {
    await rsvp('a1'); await rsvp('a2'); await rsvp('w1');
    const s = await cancel('w1');
    expect(s.promotedAthleteIds).toEqual([]);
    expect(s.registeredCount).toBe(2);
  });

  it('a capacity raise fills every freed spot', async () => {
    await rsvp('a1'); await rsvp('a2'); await tick(); await rsvp('w1'); await tick(); await rsvp('w2'); await tick(); await rsvp('w3');
    db.tables.events[0].capacity = 4;
    const promoted = await rebalanceWaitlist(db.client as never, 'e1', 4);
    expect(promoted).toEqual(['w1', 'w2']);
    expect(statusOf('w3')).toBe('waitlisted');
  });

  it('removing the capacity lets everyone in; lowering it demotes nobody', async () => {
    await rsvp('a1'); await rsvp('a2'); await rsvp('w1');
    expect(await rebalanceWaitlist(db.client as never, 'e1', 1)).toEqual([]);
    expect(statusOf('a2')).toBe('registered');
    expect(await rebalanceWaitlist(db.client as never, 'e1', null)).toEqual(['w1']);
  });

  it('cancel then re-RSVP with room is registered again, counted once', async () => {
    await rsvp('a1');
    await cancel('a1');
    const b = await rsvp('a1');
    expect(b.registration.status).toBe('registered');
    expect(b.registeredCount).toBe(1);
  });
});
