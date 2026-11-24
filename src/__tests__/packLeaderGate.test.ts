import { describe, expect, it, vi, beforeEach } from 'vitest';
import { makeFakeDb, eqOf, session, type Op } from './helpers/packsFakeDb';

/**
 * b23 pack leaders (migration 215). Pinned: requirePackLeader passes a leader of THAT pack and
 * staff, nobody else; a leader's responses never carry a verdict, HR or pain; the week summary
 * (pain items) is staff-only — a leader is refused.
 */

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
vi.mock('@/lib/maintenance', () => ({ readMaintenance: async () => null, maintenanceBlocks: () => false }));

let tables: Record<string, (op: Op) => unknown[]> = {};
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => makeFakeDb(tables) }));

const { requirePackLeader } = await import('@/lib/auth/self-or-staff');
const { forLeader, isLeaderForbiddenKey } = await import('@/lib/packs/leader-safe');
const { withoutPain } = await import('@/lib/packs/summary');
const home = await import('@/app/api/packs/[id]/home/route');
const summary = await import('@/app/api/packs/[id]/week-summary/route');

const PACK = 'pack-1';
const req = (url = 'https://x.test/api/packs/pack-1/home') => new Request(url, { headers: { authorization: 'Bearer t' } });
const params = { params: Promise.resolve({ id: PACK }) };

beforeEach(() => {
  requireSession.mockReset();
  tables = {
    pack_leaders: (op) => (eqOf(op, 'pack_id') === PACK && eqOf(op, 'athlete_id') === 'leader-1' ? [{ pack_id: PACK }] : []),
  };
});

describe('requirePackLeader', () => {
  it('passes a leader of that pack, as a leader', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'leader-1' }));
    const r = await requirePackLeader(req(), PACK);
    expect(r.denied).toBeNull();
    expect(r.asLeader).toBe(true);
  });
  it('refuses a leader of another pack', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'leader-1' }));
    expect((await requirePackLeader(req(), 'pack-2')).denied?.status).toBe(403);
  });
  it('refuses a plain member', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'runner-9' }));
    expect((await requirePackLeader(req(), PACK)).denied?.status).toBe(403);
  });
  it('passes staff, not as a leader', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'coach-1', role: 'coach', isStaff: true }));
    const r = await requirePackLeader(req(), PACK);
    expect(r.denied).toBeNull();
    expect(r.asLeader).toBe(false);
  });
});

describe('a leader never receives verdict, HR or pain', () => {
  it('forLeader strips them at any depth', () => {
    const out = forLeader({
      members: [{ name: 'a', verdict: { score: 90 }, avgHr: 150, maxHR: 180, heartRate: 1, pain: true, painArea: 'knee', daysSinceRun: 2 }],
      planVerdict: 1, hr: 140, accuracy: 0.9, readCount: 3,
    });
    expect(out).toEqual({ members: [{ name: 'a', daysSinceRun: 2 }], readCount: 3 });
  });
  it('keeps ordinary keys', () => {
    for (const k of ['three', 'readPlan', 'shareCount', 'hrefs'.slice(0, 4), 'sendAt', 'athleteId']) {
      expect(isLeaderForbiddenKey(k)).toBe(false);
    }
  });
  it('the home route response has no forbidden key anywhere', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'leader-1' }));
    tables.groups = () => [{ id: PACK, name: 'Group 2' }];
    tables.athletes = () => [{ id: 'm1', name: 'Dana', avatar_url: null, last_seen_at: '2026-11-24T05:00:00Z', status: 'active' }];
    tables.pack_moments = () => [{ id: 'mo1', kind: 'reminder', body: 'מחר 05:30', send_at: null, sent_at: null, ready_by: null }];
    const res = await home.GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    };
    walk(body);
    expect(keys.filter(isLeaderForbiddenKey)).toEqual([]);
    expect(body.memberCount).toBe(1);
    expect(body.members[0]).toEqual(expect.objectContaining({ athleteId: 'm1', name: 'Dana' }));
  });
});

describe('week summary — pain is staff-only', () => {
  it('refuses the pack leader', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'leader-1' }));
    const res = await summary.GET(req('https://x.test/api/packs/pack-1/week-summary?week=2026-11-15'), params);
    expect(res.status).toBe(403);
  });
  it('gives staff the pain items', async () => {
    requireSession.mockResolvedValue(session({ athleteId: 'coach-1', role: 'coach', isStaff: true }));
    tables.pack_week_summaries = () => [{
      week_start: '2026-11-15', msg_by_day: [1, 0, 0, 0, 0, 0, 0], attendance: [],
      items: [{ kind: 'pain', athleteId: 'm1', text: 'כואב לי הברך', messageId: 'x' }],
    }];
    const res = await summary.GET(req('https://x.test/api/packs/pack-1/week-summary?week=2026-11-18'), params);
    const body = await res.json();
    expect(body.summary.weekStart).toBe('2026-11-15');
    expect(body.summary.items[0].kind).toBe('pain');
  });
  it('withoutPain drops pain items', () => {
    const s = withoutPain({ weekStart: 'w', msgByDay: [], attendance: [], items: [
      { kind: 'pain', athleteId: 'a', text: 't', messageId: '1' },
      { kind: 'question', athleteId: 'a', text: 't?', messageId: '2' },
    ] });
    expect(s.items.map((i) => i.kind)).toEqual(['question']);
  });
});
