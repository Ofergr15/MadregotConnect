// Task 154: a poll's results per pack — staff-only, counts only (anonymous-safe).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { surveyByGroup } from '@/lib/survey-by-group';

const groups = [{ id: 'g3', name: 'SUB 2:45' }, { id: 'g1', name: 'SUB 2:30' }, { id: 'g2', name: 'SUB 2:35' }];
const pack: Record<string, string | null> = { a: 'g1', b: 'g1', c: 'g3', d: null, e: 'gone', m: 'g2' };

describe('surveyByGroup', () => {
  it('asked / answered / per-option counts per pack, lane order, no pack last', () => {
    const r = surveyByGroup({
      optionCount: 3,
      asked: ['a', 'b', 'c', 'd', 'e'],
      responses: [{ athlete_id: 'a', option_index: 0 }, { athlete_id: 'c', option_index: 2 }, { athlete_id: 'd', option_index: 1 }],
      groupOf: (id) => pack[id] ?? null,
      groups,
    });
    expect(r.map((g) => [g.groupId, g.lane, g.asked, g.answered, g.counts, g.responsePct])).toEqual([
      ['g1', 1, 2, 1, [1, 0, 0], 50],
      ['g3', 3, 1, 1, [0, 0, 1], 100],
      [null, null, 2, 1, [0, 1, 0], 50],     // no pack + an unknown pack id
    ]);
  });

  it('multi-answer: several options, one person; a duplicate row counts once', () => {
    const [g1] = surveyByGroup({
      optionCount: 2, asked: ['a'], groupOf: (id) => pack[id] ?? null, groups,
      responses: [{ athlete_id: 'a', option_index: 0 }, { athlete_id: 'a', option_index: 1 }, { athlete_id: 'a', option_index: 1 }],
    });
    expect(g1).toMatchObject({ answered: 1, counts: [1, 1], responsePct: 100 });
  });

  it('someone outside the audience who answered still counts (under their pack now); a bad index is ignored', () => {
    const r = surveyByGroup({
      optionCount: 2, asked: ['a'], groupOf: (id) => pack[id] ?? null, groups,
      responses: [{ athlete_id: 'm', option_index: 1 }, { athlete_id: 'a', option_index: 5 }],
    });
    expect(r.find((g) => g.groupId === 'g2')).toMatchObject({ asked: 0, answered: 1, counts: [0, 1], responsePct: null });
    expect(r.find((g) => g.groupId === 'g1')).toMatchObject({ asked: 1, answered: 0, counts: [0, 0] });
  });
});

// ── GET /api/admin/content/surveys/[id], on fixture tables ────────────────────
type R = { data: unknown; error: unknown };
let tables: Record<string, R> = {};
class Q implements PromiseLike<R> {
  constructor(private t: string) {}
  select() { return this; } eq() { return this; } in() { return this; } is() { return this; } order() { return this; } limit() { return this; } maybeSingle() { return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));
const gate = vi.fn();
vi.mock('@/lib/access/require-content', () => ({ requireContentLevel: (...a: unknown[]) => gate(...a) }));
vi.mock('@/lib/auth/require-approver', () => ({ requireApprover: async () => ({ denied: new Response(null, { status: 403 }), email: '' }) }));
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaff: async () => null }));
vi.mock('@/lib/surveys', () => ({
  surveyAudienceIds: async () => ['a', 'b', 'c'],
  cancelSurveyReminders: async () => {},
  notifySurveyNonResponders: async () => 0,
}));

const get = async () => (await import('@/app/api/admin/content/surveys/[id]/route')).GET(new Request('http://x'), { params: Promise.resolve({ id: 's1' }) });

beforeEach(() => {
  gate.mockReset().mockResolvedValue({ denied: null, user: { isStaff: true }, levels: {} });
  tables = {
    surveys: { data: { id: 's1', question_he: 'מגיעים?', options_he: ['כן', 'לא'], closes_at: null, created_at: '2026-11-27T10:00:00Z', audience_type: 'all', audience_id: null, anonymous: true, created_by: null }, error: null },
    survey_responses: { data: [{ athlete_id: 'a', option_index: 0, created_at: '2026-11-27T11:00:00Z' }, { athlete_id: 'c', option_index: 1, created_at: '2026-11-27T12:00:00Z' }], error: null },
    athletes: { data: [{ id: 'a', name: 'A', group_id: 'g1' }, { id: 'b', name: 'B', group_id: 'g1' }, { id: 'c', name: 'C', group_id: 'g3' }], error: null },
    groups: { data: groups, error: null },
  };
});

describe('GET /api/admin/content/surveys/[id] — byGroup', () => {
  it('returns the per-pack breakdown next to the existing results', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byGroup.map((g: { groupId: string; asked: number; answered: number; counts: number[] }) => [g.groupId, g.asked, g.answered, g.counts])).toEqual([
      ['g1', 2, 1, [1, 0]],
      ['g3', 1, 1, [0, 1]],
    ]);
    // Counts only: no names inside the breakdown (it is the same for an anonymous poll).
    expect(JSON.stringify(body.byGroup)).not.toMatch(/"name":"[ABC]"/);
    expect(body.asked).toBe(3);
  });

  it('staff-only: the gate is the content gate at level 1, and a refusal passes through', async () => {
    gate.mockResolvedValue({ denied: new Response(null, { status: 403 }) });
    expect((await get()).status).toBe(403);
    expect(gate).toHaveBeenCalledWith(expect.any(Request), 'surveys', 1, expect.any(Function));
  });
});
