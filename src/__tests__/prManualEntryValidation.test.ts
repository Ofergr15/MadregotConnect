import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { normaliseTimeInput, cleanNote, checkAchievedOn } from '@/lib/prs/manual-entry';
import { parsePrSeconds } from '@/lib/prs/overrides';

const RLM = String.fromCharCode(0x200f);
const LRM = String.fromCharCode(0x200e);
const RLO = String.fromCharCode(0x202e);
const arabicIndic = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

describe('manual record input — Hebrew/RTL-safe', () => {
  it('a time typed in an RTL field still parses', () => {
    expect(parsePrSeconds(normaliseTimeInput(`${RLM}41:58${LRM}`))).toBe(41 * 60 + 58);
    expect(parsePrSeconds(normaliseTimeInput(arabicIndic('3:12:40')))).toBe(3 * 3600 + 12 * 60 + 40);
    expect(parsePrSeconds(normaliseTimeInput(' 41 : 58 '))).toBe(2518);
    expect(parsePrSeconds(normaliseTimeInput(`41${String.fromCharCode(0xff1a)}58`))).toBe(2518);
  });
  it('notes lose bidi override controls but keep Hebrew text', () => {
    expect(cleanNote(`מרתון ${RLO}תל אביב`)).toBe('מרתון תל אביב');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote('x'.repeat(300))).toHaveLength(200);
  });
  it('achievedOn must be a real, past, plausible date', () => {
    expect(checkAchievedOn('2026-02-27', '2026-11-27')).toEqual({ ok: true, value: '2026-02-27' });
    expect(checkAchievedOn('', '2026-11-27')).toEqual({ ok: true, value: null });
    expect(checkAchievedOn('2026-02-30', '2026-11-27')).toEqual({ ok: false, code: 'bad-date' });
    expect(checkAchievedOn('27/02/2026', '2026-11-27')).toEqual({ ok: false, code: 'bad-date' });
    expect(checkAchievedOn('2026-12-01', '2026-11-27')).toEqual({ ok: false, code: 'future-date' });
    expect(checkAchievedOn('1901-01-01', '2026-11-27')).toEqual({ ok: false, code: 'too-old' });
  });
});

let caller = { athleteId: 'a1', isStaff: false, isSuperUser: false };
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig() as object),
  requireCallerForAthlete: async () => ({ denied: null, caller }),
}));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const route = await import('@/app/api/athletes/prs/route');
const put = (body: unknown) => route.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }));
const del = () => route.DELETE(new Request('http://x/api/athletes/prs?athleteId=a1&bucketKey=10k', { method: 'DELETE' }));

function seed(audit = true) {
  db = createMemoryDb({
    schema: {
      athlete_pr_overrides: ['athlete_id', 'bucket_key', 'seconds', 'achieved_on', 'note', 'hidden', 'updated_at'],
      ...(audit ? { athlete_pr_override_events: ['athlete_id', 'bucket_key', 'action', 'seconds', 'previous_seconds', 'achieved_on', 'changed_by', 'changed_at'] } : {}),
    },
  });
}

describe('PUT/DELETE /api/athletes/prs — validation + audit trail', () => {
  beforeEach(() => { seed(); caller = { athleteId: 'a1', isStaff: false, isSuperUser: false }; });

  it('accepts an RTL-wrapped time and records who set it', async () => {
    const res = await put({ athleteId: 'a1', bucketKey: '10k', time: `${RLM}41:58`, achievedOn: '2026-02-27', note: 'מרוץ' });
    expect(res.status).toBe(200);
    expect(db.tables.athlete_pr_overrides[0]).toMatchObject({ seconds: 2518, achieved_on: '2026-02-27', note: 'מרוץ' });
    expect(db.tables.athlete_pr_override_events[0]).toMatchObject({ action: 'set', seconds: 2518, previous_seconds: null, changed_by: 'a1' });
  });

  it('an edit by staff records the previous time and the staff member', async () => {
    await put({ athleteId: 'a1', bucketKey: '10k', time: '42:30' });
    caller = { athleteId: 'coach-1', isStaff: true, isSuperUser: false };
    await put({ athleteId: 'a1', bucketKey: '10k', time: '41:58' });
    expect(db.tables.athlete_pr_override_events[1]).toMatchObject({ previous_seconds: 2550, seconds: 2518, changed_by: 'coach-1' });
  });

  it('refuses a future date and an impossible time', async () => {
    expect((await put({ athleteId: 'a1', bucketKey: '10k', time: '41:58', achievedOn: '2099-01-01' })).status).toBe(400);
    expect((await put({ athleteId: 'a1', bucketKey: '10k', time: '9:00' })).status).toBe(400);
    expect(db.tables.athlete_pr_overrides).toHaveLength(0);
  });

  it('a clear is audited', async () => {
    await put({ athleteId: 'a1', bucketKey: '10k', time: '41:58' });
    expect((await del()).status).toBe(200);
    expect(db.tables.athlete_pr_override_events.at(-1)).toMatchObject({ action: 'clear', previous_seconds: 2518 });
  });

  it('still saves before the audit migration', async () => {
    seed(false);
    expect((await put({ athleteId: 'a1', bucketKey: '10k', time: '41:58' })).status).toBe(200);
    expect(db.tables.athlete_pr_overrides).toHaveLength(1);
  });
});
