import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { kindChosen, kindHint, missingKinds } from '@/lib/academy/kind-choice';

/** A book entry's type is chosen, never preselected (Ofer, 2026-10-20). */

describe('the rule', () => {
  it('nothing is chosen until a real type is', () => {
    expect(kindChosen(null)).toBe(false);
    expect(kindChosen('fast')).toBe(false);
    expect(kindChosen('intervals')).toBe(true);
  });
  it('the inferred type is only a hint, and not once it is the choice', () => {
    expect(kindHint('intervals', null)).toBe('intervals');
    expect(kindHint('intervals', 'intervals')).toBeNull();
    expect(kindHint('nonsense', null)).toBeNull();
  });
  it('every ticked import row needs its own type', () => {
    expect(missingKinds(['a', 'b'], { a: 'easy' })).toEqual(['b']);
    expect(missingKinds(['a'], { a: 'easy' })).toEqual([]);
  });
});

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: 'm', isSuperUser: true, isStaff: true, role: 'admin' } }) }));
vi.mock('@/lib/academy/book-server', () => ({ loadLaneReferences: async () => ({ 1: 230, 2: 245, 3: 260 }), loadThresholds: async () => ({}) }));
const STEPS = [{ type: 'interval', repeatCount: 5, durationType: 'distance', durationValue: 0, repeatSteps: [{ type: 'interval', durationType: 'distance', durationValue: 500, intensity: { fastPct: 112, slowPct: 108 } }, { type: 'rest', durationType: 'time', durationValue: 60 }] }];
vi.mock('@/lib/academy/book-import', async (orig) => ({
  ...(await orig<typeof import('@/lib/academy/book-import')>()),
  buildImport: () => [{ key: 'k1', name: '5 × 500 מ׳', kind: 'intervals', steps: STEPS, uses: 2, lastWeek: '2026-10-18', status: 'new', reasons: [], sources: [], existingId: null, saveable: true }],
}));
const { POST } = await import('@/app/api/academy/library/import/route');
const post = (body: unknown) => POST(new Request('http://x/api/academy/library/import', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/academy/library/import', () => {
  beforeEach(() => {
    db = createMemoryDb({ schema: {
      weekly_plans: ['id', 'athlete_id', 'week_start_date', 'parsed_workouts', 'coach_id'],
      academy_workout_library: ['id', 'scope', 'owner_id', 'name', 'kind', 'notes', 'steps', 'use_count', 'last_used_at', 'archived_at'],
    }, defaults: { academy_workout_library: () => ({ id: uid() }) } } as never);
  });
  it('refuses a row with no chosen type', async () => {
    const res = await post({ keys: ['k1'] });
    expect(res.status).toBe(400);
    expect((await res.json()).keys).toEqual(['k1']);
    expect(db.tables.academy_workout_library).toHaveLength(0);
  });
  it('writes the CHOSEN type, not the inferred one', async () => {
    const res = await post({ keys: ['k1'], kinds: { k1: 'tempo' } });
    expect(res.status).toBe(200);
    expect(db.tables.academy_workout_library[0]).toMatchObject({ name: '5 × 500 מ׳', kind: 'tempo' });
  });
});
