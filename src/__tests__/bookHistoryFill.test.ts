import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import {
  buildImport, daySessionRow, easyRunKey, fillRows, importKeyOf, roughName, sourceCounts, templateRow,
  type ImportPlanRow,
} from '@/lib/academy/book-import';
import { filterLibrary, isUnclassified, type LibraryEntry, type LibraryStep } from '@/lib/academy/library';

/**
 * The book filled from the whole history (Ofer, 2026-10-20: "maybe run over all the workouts
 * we put into the app historically?") — every store, merged, written unclassified, and the
 * classify round trip that turns a guess into a choice.
 */

// Lane 1's paces, as the club writes them (sec/km), so the conversion has something to work on.
const easy = (sec: number, pace: number) => ({
  type: 'active', targetType: 'pace', durationType: 'time', durationValue: sec,
  targetPaceMinPerKm: pace - 15, targetPaceMaxPerKm: pace + 15,
});
const reps = (count: number, metres: number, pace: number, restSec: number) => ({
  type: 'interval', targetType: 'pace', repeatCount: count, durationType: 'time', durationValue: 0,
  repeatSteps: [
    { type: 'interval', targetType: 'pace', durationType: 'distance', durationValue: metres, targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace },
    { type: 'rest', targetType: 'no_target', durationType: 'time', durationValue: restSec },
  ],
});
const week = (id: string, weekStart: string, workouts: unknown[]): ImportPlanRow => ({
  id, athleteId: null, weekStart,
  // The club's week in the shape laneWorkouts reads: one plan for every lane.
  parsed: { workouts },
});

const REF = 203;

describe('every store a workout was written in', () => {
  it('reads club weeks, one-day sessions and legacy templates, and counts them', () => {
    const rows: ImportPlanRow[] = [
      week('w1', '2026-09-06', [{ dayOfWeek: 2, name: 'שלישי', steps: [easy(900, 300), reps(6, 1000, 225, 90), easy(600, 300)] }]),
      daySessionRow({ id: 'd1', session_date: '2026-10-18', title: '50 דק׳', steps: [easy(900, 300), reps(15, 200, 205, 60)] })!,
      templateRow({ id: 't1', name: 'פירמידה', workout: { steps: [easy(600, 300), reps(4, 800, 220, 120)] }, created_at: '2026-08-01T00:00:00Z' })!,
    ];
    expect(sourceCounts(rows)).toEqual({ club: 1, academy: 0, day: 1, template: 1 });
    const c = buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] });
    const origins = new Set(c.flatMap(x => x.sources.map(s => s.origin)));
    expect(origins).toEqual(new Set(['club', 'day', 'template']));
    expect(c).toHaveLength(3);
  });

  it('skips a day session or template with no steps', () => {
    expect(daySessionRow({ id: 'x', session_date: '2026-10-18', steps: [] })).toBeNull();
    expect(templateRow({ id: 'x', workout: { name: 'ריק' } })).toBeNull();
  });
});

describe('dedup', () => {
  it('merges an easy run by its length, whatever pace it was written at, and keeps the count', () => {
    const rows = [
      week('a', '2026-09-06', [{ dayOfWeek: 1, name: 'שני', steps: [easy(3600, 300)] }]),
      week('b', '2026-09-13', [{ dayOfWeek: 1, name: 'שני', steps: [easy(3600, 310)] }]),
      week('c', '2026-09-20', [{ dayOfWeek: 1, name: 'שני', steps: [easy(3600, 290)] }]),
    ];
    const c = buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] });
    expect(c).toHaveLength(1);
    expect(c[0].uses).toBe(3);
    expect(c[0].lastWeek).toBe('2026-09-20');
    expect(c[0].key).toBe('easy:t3600');
  });

  it('never merges a session with real work into an easy run', () => {
    const rows = [
      week('a', '2026-09-06', [{ dayOfWeek: 1, name: 'שני', steps: [easy(3600, 300)] }]),
      week('b', '2026-09-13', [{ dayOfWeek: 2, name: 'שלישי', steps: [easy(1800, 300), reps(6, 1000, 225, 90), easy(1200, 300)] }]),
    ];
    const c = buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] });
    expect(c).toHaveLength(2);
  });

  it('a repeated set with a different easy pace around it is still one structure', () => {
    const rows = [
      week('a', '2026-09-06', [{ dayOfWeek: 2, name: 'שלישי', steps: [easy(900, 300), reps(6, 1000, 225, 90)] }]),
      week('b', '2026-09-13', [{ dayOfWeek: 2, name: 'שלישי', steps: [easy(900, 305), reps(6, 1000, 222, 90)] }]),
    ];
    const c = buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] });
    expect(c).toHaveLength(1);
    expect(c[0].uses).toBe(2);
  });

  it('names a session the editor cannot draw by its sets, not the weekday', () => {
    const steps: LibraryStep[] = [
      { type: 'warmup', targetType: 'pace', durationType: 'open', intensity: { fastPct: 69, slowPct: 66 } } as LibraryStep,
      { type: 'interval', targetType: 'no_target', durationType: 'time', durationValue: 0, repeatCount: 2, repeatSteps: [
        { type: 'interval', targetType: 'no_target', durationType: 'time', durationValue: 20 } as LibraryStep,
        { type: 'rest', targetType: 'no_target', durationType: 'open' } as LibraryStep,
      ] } as LibraryStep,
      { type: 'interval', targetType: 'no_target', durationType: 'time', durationValue: 0, repeatCount: 6, repeatSteps: [
        { type: 'interval', targetType: 'no_target', durationType: 'time', durationValue: 540 } as LibraryStep,
        { type: 'rest', targetType: 'no_target', durationType: 'time', durationValue: 60 } as LibraryStep,
      ] } as LibraryStep,
    ];
    expect(roughName(steps)).toBe('6 × 9 דק׳');
    expect(roughName(steps.slice(0, 2), 'עליות')).toBe('2 × 20 שנ׳ עליות');
  });

  it('easyRunKey is null for anything with faster work', () => {
    expect(easyRunKey([{ type: 'active', targetType: 'pace', durationType: 'time', durationValue: 1800, intensity: { fastPct: 95, slowPct: 92 } } as LibraryStep])).toBeNull();
  });
});

describe('fillRows — idempotent, never over what is there', () => {
  const rows = [
    week('a', '2026-09-06', [
      { dayOfWeek: 1, name: 'שני', steps: [easy(3600, 300)] },
      { dayOfWeek: 2, name: 'שלישי', steps: [easy(900, 300), reps(6, 1000, 225, 90), easy(600, 300)] },
    ]),
  ];

  it('writes every new session, unclassified, with its guess and history', () => {
    const f = fillRows(buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] }));
    expect(f).toHaveLength(2);
    expect(f.every(r => r.kindConfirmed === false)).toBe(true);
    expect(f.find(r => r.key === 'easy:t3600')).toMatchObject({ uses: 1, lastWeek: '2026-09-06' });
  });

  it('a second run adds nothing', () => {
    const first = fillRows(buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] }));
    const existing = first.map((r, i) => ({ id: String(i), name: r.name, steps: r.steps, importKey: r.key }));
    expect(fillRows(buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing }))).toHaveLength(0);
  });

  it('an entry a coach has since edited is matched by the key it came in under, not re-added', () => {
    const first = fillRows(buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: [] }));
    const edited = first.map((r, i) => ({
      id: String(i), name: r.name, importKey: r.key,
      // The coach changed the steps: a different structure now.
      steps: [{ type: 'active', targetType: 'pace', durationType: 'time', durationValue: 1234 + i } as LibraryStep],
    }));
    expect(importKeyOf(edited[0].steps)).not.toBe(first[0].key);
    expect(fillRows(buildImport({ plans: rows, thresholds: {}, clubReferenceSec: REF, existing: edited }))).toHaveLength(0);
  });
});

describe('unclassified in the book', () => {
  const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
    id: uid(), scope: 'academy', ownerId: 'o', ownerName: null, name: '6 × 1 ק״מ', kind: 'intervals', notes: null,
    steps: [], useCount: 1, lastUsedAt: null, createdAt: '', ...over,
  });

  it('is out of the type filters, and searchable', () => {
    const guessed = entry({ name: '6 × 1 ק״מ', kind: 'intervals', kindConfirmed: false });
    const chosen = entry({ name: '5 × 1 ק״מ', kind: 'intervals' });
    expect(isUnclassified(guessed)).toBe(true);
    expect(isUnclassified(chosen)).toBe(false);
    expect(filterLibrary([guessed, chosen], { kind: 'intervals' }).map(e => e.name)).toEqual(['5 × 1 ק״מ']);
    expect(filterLibrary([guessed, chosen], { query: '6 ×' }).map(e => e.name)).toEqual(['6 × 1 ק״מ']);
    expect(filterLibrary([guessed, chosen], {})).toHaveLength(2);
  });
});

// ── The routes, on an in-memory database ──────────────────────────────────────────────

const MANAGER = uid();
const COACH = uid();
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
let caller: Record<string, unknown> = { athleteId: MANAGER, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: ['academy_manager'] };
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller }) }));

const LIB = ['id', 'scope', 'owner_id', 'name', 'kind', 'notes', 'steps', 'use_count', 'last_used_at', 'archived_at', 'created_at', 'updated_at'];
const schema = (withKindColumns: boolean): Record<string, string[]> => ({
  weekly_plans: ['id', 'coach_id', 'athlete_id', 'week_start_date', 'parsed_workouts'],
  day_sessions: ['id', 'session_date', 'title', 'steps'],
  academy_workouts: ['id', 'name', 'workout', 'created_at'],
  academy_workout_library: withKindColumns ? [...LIB, 'kind_confirmed', 'import_key'] : LIB,
  academy_tests: ['id', 'athlete_id', 'test_date', 'protocol', 'duration_sec', 'distance_m', 'excluded_reason', 'status'],
  groups: ['id', 'name', 'coach_id'],
  athletes: ['id', 'name'],
});

const { COACH_ID } = await import('@/lib/constants');
const importRoute = await import('@/app/api/academy/library/import/route');
const libraryRoute = await import('@/app/api/academy/library/route');
const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });

function seed(withKindColumns = true) {
  db = createMemoryDb({
    schema: schema(withKindColumns),
    defaults: { academy_workout_library: () => ({ id: uid(), created_at: new Date().toISOString(), archived_at: null, kind_confirmed: true }) },
  } as never);
  if (!withKindColumns) {
    // Without migration 159 the default has nowhere to go.
    db = createMemoryDb({ schema: schema(false), defaults: { academy_workout_library: () => ({ id: uid(), created_at: new Date().toISOString(), archived_at: null }) } } as never);
  }
  db.tables.weekly_plans.push({
    id: uid(), coach_id: COACH_ID, athlete_id: null, week_start_date: '2026-09-06',
    parsed_workouts: { workouts: [
      { dayOfWeek: 1, name: 'שני', steps: [easy(3600, 300)] },
      { dayOfWeek: 2, name: 'שלישי', steps: [easy(900, 300), reps(6, 1000, 225, 90), easy(600, 300)] },
    ] },
  });
  db.tables.day_sessions.push({ id: uid(), session_date: '2026-10-18', title: '50 דק׳', steps: [easy(900, 300), reps(15, 200, 205, 60)] });
}

describe('POST /api/academy/library/import { action: "fill" }', () => {
  beforeEach(() => {
    caller = { athleteId: MANAGER, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: ['academy_manager'] };
    seed();
  });

  it('previews, then writes every session unclassified — and a second run adds nothing', async () => {
    const preview = await (await importRoute.GET(req('/api/academy/library/import'))).json();
    expect(preview.fill).toMatchObject({ toAdd: 3, alreadyIn: 0, ready: true, sources: { club: 1, day: 1, template: 0, academy: 0 } });

    const res = await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }));
    expect(await res.json()).toEqual({ written: 3, skipped: 0 });
    const lib = db.tables.academy_workout_library;
    expect(lib).toHaveLength(3);
    expect(lib.every(r => r.kind_confirmed === false && r.scope === 'academy' && typeof r.import_key === 'string')).toBe(true);

    expect(await (await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }))).json()).toEqual({ written: 0, skipped: 0 });
    expect(db.tables.academy_workout_library).toHaveLength(3);
  });

  it('never touches an entry that is already classified or hand-edited', async () => {
    await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }));
    const row = db.tables.academy_workout_library[0];
    row.kind = 'tempo'; row.kind_confirmed = true; row.name = 'השם של המאמן';
    row.steps = [{ type: 'active', targetType: 'pace', durationType: 'time', durationValue: 999 }];
    await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }));
    expect(db.tables.academy_workout_library).toHaveLength(3);
    expect(db.tables.academy_workout_library[0]).toMatchObject({ kind: 'tempo', kind_confirmed: true, name: 'השם של המאמן' });
  });

  it('refuses to write without migration 159, rather than let a guess read as a choice', async () => {
    seed(false);
    const preview = await (await importRoute.GET(req('/api/academy/library/import'))).json();
    expect(preview.fill.ready).toBe(false);
    const res = await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }));
    expect(res.status).toBe(409);
    expect(db.tables.academy_workout_library).toHaveLength(0);
  });

  it('is a manager’s door', async () => {
    caller = { athleteId: COACH, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: [] };
    expect((await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }))).status).toBe(403);
  });
});

describe('classify — the round trip', () => {
  beforeEach(async () => {
    caller = { athleteId: MANAGER, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: ['academy_manager'] };
    seed();
    await importRoute.POST(req('/api/academy/library/import', 'POST', { action: 'fill' }));
  });

  it('reads as unclassified, then a chosen type sticks and shows under its chip', async () => {
    let body = await (await libraryRoute.GET(req('/api/academy/library'))).json();
    expect(body.entries).toHaveLength(3);
    expect(body.entries.every((e: LibraryEntry) => e.kindConfirmed === false)).toBe(true);
    expect(filterLibrary(body.entries, { kind: 'intervals' })).toHaveLength(0);

    const target = body.entries[0] as LibraryEntry;
    const res = await libraryRoute.PATCH(req('/api/academy/library', 'PATCH', { id: target.id, action: 'classify', kind: 'intervals' }));
    expect(res.status).toBe(200);
    expect((await res.json()).entry.kindConfirmed).toBeUndefined();

    body = await (await libraryRoute.GET(req('/api/academy/library'))).json();
    const after = body.entries.find((e: LibraryEntry) => e.id === target.id);
    expect(after.kind).toBe('intervals');
    expect(isUnclassified(after)).toBe(false);
    expect(filterLibrary(body.entries, { kind: 'intervals' }).map((e: LibraryEntry) => e.id)).toEqual([target.id]);
  });

  it('refuses an unknown type, and a coach on the canon', async () => {
    const id = db.tables.academy_workout_library[0].id;
    expect((await libraryRoute.PATCH(req('/api/academy/library', 'PATCH', { id, action: 'classify', kind: 'fast' }))).status).toBe(400);
    caller = { athleteId: COACH, isStaff: true, isSuperUser: false, role: 'academy_coach', roles: [] };
    expect((await libraryRoute.PATCH(req('/api/academy/library', 'PATCH', { id, action: 'classify', kind: 'tempo' }))).status).toBe(404);
  });

  it('an edit that sets the type confirms it too', async () => {
    const id = db.tables.academy_workout_library[0].id;
    await libraryRoute.PATCH(req('/api/academy/library', 'PATCH', { id, action: 'edit', kind: 'long' }));
    expect(db.tables.academy_workout_library[0]).toMatchObject({ kind: 'long', kind_confirmed: true });
  });
});
