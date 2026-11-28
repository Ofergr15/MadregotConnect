// Task 92: RSVP reminder data — who hasn't answered, staff-only, default-off, never sends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRemindable, rsvpCounts, unansweredFor } from '@/lib/events/rsvp-reminder';
import { FEATURES } from '@/lib/features/flags';

const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), requireStaffCaller: (r: Request) => requireStaffCaller(r) }));
const flag = vi.fn(async () => true);
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: () => flag() }));
const sendPush = vi.fn();
vi.mock('@/lib/push', () => ({ notifyAthlete: sendPush, sendPushToAthlete: sendPush }));
let noStatusColumn = false;
let event: unknown = { id: 'e1', name: 'ריצת חורף', date: '2099-01-10', status: 'published' };
const regs = [{ athlete_id: 'a', status: 'registered' }, { athlete_id: 'b', status: 'cancelled' }, { athlete_id: 'c', status: 'waitlisted' }];
const roster = [
  { id: 'a', name: 'אבי', status: 'active' }, { id: 'b', name: 'בתיה', status: 'active' }, { id: 'c', name: 'גיל', status: 'active' },
  { id: 'd', name: 'דנה', status: 'active' }, { id: 'e', name: 'Test Runner', status: 'active' },
];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(t: string) {
      let cols = '';
      const q: any = { select: (c: string) => { cols = c; return q; }, eq: () => q,
        maybeSingle: async () => (noStatusColumn && cols.includes('status') ? { data: null, error: { code: '42703' } } : { data: event, error: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: t === 'athletes' ? roster : regs, error: null }).then(r) };
      return q;
    },
  }),
}));
const { GET } = await import('@/app/api/events/[id]/rsvp-reminder/route');
const call = () => GET(new Request('http://x'), { params: Promise.resolve({ id: 'e1' }) });
beforeEach(() => {
  requireStaffCaller.mockResolvedValue({ denied: null, caller: { athleteId: 's1', isStaff: true } });
  flag.mockResolvedValue(true); noStatusColumn = false; event = { id: 'e1', name: 'ריצת חורף', date: '2099-01-10', status: 'published' };
});

describe('pure', () => {
  it('a cancel is an answer; test accounts and inactive members are skipped', () => {
    expect(unansweredFor([...roster, { id: 'z', name: 'Zed', status: 'invited' }], regs).map((u) => u.athleteId)).toEqual(['d']);
  });
  it('counts by status', () => expect(rsvpCounts(regs)).toEqual({ registered: 1, waitlisted: 1, cancelled: 1 }));
  it('only upcoming published events are remindable', () => {
    expect(isRemindable({ date: '2026-12-01' }, '2026-11-28')).toBe(true);
    expect(isRemindable({ date: '2026-11-27' }, '2026-11-28')).toBe(false);
    expect(isRemindable({ date: '2026-12-01', status: 'draft' }, '2026-11-28')).toBe(false);
  });
  it('the flag is default-off', () => expect(FEATURES.event_rsvp_reminder.defaultEnabled).toBe(false));
});

describe('GET /api/events/[id]/rsvp-reminder', () => {
  it('staff get the unanswered list and a push preview — dry run, nothing sent', async () => {
    const body = await (await call()).json();
    expect(body).toMatchObject({ dryRun: true, remindable: true, counts: { registered: 1 }, unanswered: [{ athleteId: 'd', name: 'דנה' }] });
    expect(body.push.url).toBe('/dashboard/calendar/e1');
    expect(sendPush).not.toHaveBeenCalled();
  });
  it('without the 184 status column the event still loads and counts as published', async () => {
    noStatusColumn = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).remindable).toBe(true);
  });
  it('names only — no email/phone keys in the payload', async () => {
    expect(JSON.stringify(await (await call()).json())).not.toMatch(/email|phone/);
  });
  it('non-staff → the gate; flag off → 404; unknown event → 404', async () => {
    requireStaffCaller.mockResolvedValueOnce({ denied: new Response(null, { status: 403 }), caller: {} });
    expect((await call()).status).toBe(403);
    flag.mockResolvedValueOnce(false);
    expect((await call()).status).toBe(404);
    event = null;
    expect((await call()).status).toBe(404);
  });
});
