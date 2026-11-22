import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/academy/manage', () => ({ waPhone: () => null }));
import { toMeetup, factsFor, type MeetupRow } from '@/lib/runs/meetups-server';

// The serialised run — what actually leaves the server — must carry the exact meeting
// point only for host + accepted joiners (migration 190 / CLAUDE.md exposure note).
const row: MeetupRow = {
  id: 'run1', host_athlete_id: 'h', date: '2026-11-21', start_time: '18:30', location: 'גשר הירקון, צד צפון',
  planned_pace: '5:00', distance_km: 12, notes: null, status: 'open', lat: 32.09981, lng: 34.81152,
  visibility: 'club', area_label: 'פארק הירקון', area_lat: 32.101, area_lng: 34.81, capacity: 3,
};
const reqs = [
  { meetup_id: 'run1', athlete_id: 'j', status: 'accepted' as const, created_at: '1' },
  { meetup_id: 'run1', athlete_id: 'w', status: 'waitlist' as const, created_at: '2' },
  { meetup_id: 'run1', athlete_id: 'p', status: 'pending' as const, created_at: '3' },
];
const people = new Map();
const view = (id: string | null) => JSON.stringify(toMeetup(row, [], people, id, 4, factsFor(row, reqs, [], id)));

describe('toMeetup location stripping', () => {
  for (const who of [null, 'stranger', 'w', 'p']) {
    it(`no exact point for ${who ?? 'anonymous'}`, () => {
      const s = view(who);
      expect(s).not.toContain('גשר');
      expect(s).not.toContain('32.0998');
      expect(s).not.toContain('34.8115');
      expect(s).toContain('פארק הירקון');
      expect(JSON.parse(s).messageCount).toBe(0);
    });
  }
  for (const who of ['h', 'j']) {
    it(`exact point for ${who}`, () => {
      const m = JSON.parse(view(who));
      expect(m.place.exact).toEqual({ name: 'גשר הירקון, צד צפון', lat: 32.09981, lng: 34.81152 });
      expect(m.location).toBe('גשר הירקון, צד צפון');
    });
  }
  it('capacity counts the host: 1 joiner + host of 3 is not full; waitlist counted; host sees requests', () => {
    const m = JSON.parse(view('h'));
    expect(m.full).toBe(false);
    expect(m.waitlistCount).toBe(1);
    expect(m.requests.map((r: { status: string }) => r.status)).toEqual(['pending', 'waitlist']);
    expect(JSON.parse(view('j')).requests).toBeUndefined();
  });
  it('a legacy row without area_* still never leaks: jittered area from the id', () => {
    const legacy = { ...row, area_label: null, area_lat: null, area_lng: null };
    const s = JSON.stringify(toMeetup(legacy, [], people, 'stranger', 0, factsFor(legacy, reqs, [], 'stranger')));
    expect(s).not.toContain('32.0998');
    expect(s).not.toContain('גשר');
  });
});
