// The reads behind "השלמת פרטים" (lib/academy/completion.ts decides). Server-only, shared by
// GET /api/academy/completion and the "לבקש מכולם" POST, so the button asks exactly the people
// the list shows as missing a test — never a wider set.
//
// Scoped like the academy home: the manager reads the academy, a coach their own trainees
// (`visibleTraineeIds`; `?scope=coach` narrows a manager). Approved, not removed members only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { thresholdPaceSec } from './tests';
import { buildCompletion, type Completion, type CompletionRow } from './completion';
import { loadGoals } from './goal-server';
import type { Goal } from './goal';
import type { TestRow as StateRow } from './test-state';
import { coachIdsByTrainee } from './trainee-coaches';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** A test as the form and the approval card need it. */
export interface StoredTestView {
  testId: string;
  date: string;
  protocol: string;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  paceSec: number | null;
  status: 'approved' | 'pending';
  /** "מהשעון" when it was read from a run, else typed. */
  source: 'watch' | 'typed';
}

export interface CompletionPerson extends CompletionRow {
  bandId: string | null;
  coachIds: string[];
  goal: Goal;
  /** The newest approved test (any protocol), to prefill the form. */
  lastTest: StoredTestView | null;
  /** A submission waiting for approval, for "לאשר". */
  pendingTest: StoredTestView | null;
}

export interface CompletionPayload extends Completion {
  rows: CompletionPerson[];
  /** False before migration 144: the goal row in the form cannot be saved yet. */
  goalsStored: boolean;
}

const TEST_COLS = 'id, athlete_id, test_date, protocol, duration_sec, distance_m, avg_hr, activity_id, excluded_reason, status';

function view(row: Record<string, any>): StoredTestView {
  const durationSec = Number(row.duration_sec);
  const distanceM = Number(row.distance_m);
  const pace = thresholdPaceSec({ durationSec, distanceM });
  return {
    testId: String(row.id),
    date: String(row.test_date).slice(0, 10),
    protocol: String(row.protocol || '30min'),
    durationSec,
    distanceM,
    avgHr: row.avg_hr == null ? null : Number(row.avg_hr),
    paceSec: pace === null ? null : Math.round(pace),
    status: row.status === 'pending' ? 'pending' : 'approved',
    source: row.activity_id ? 'watch' : 'typed',
  };
}

/** The roster this caller may see: id, name, band. `visible` null = everyone. */
async function readRoster(db: Db, visible: Set<string> | null) {
  const { data, error } = await db
    .from('athletes')
    .select('id, name, is_academy, approved, status, academy_coach_id, academy_band_id, academy_bands(band_number)')
    .eq('coach_id', COACH_ID);
  if (error) return { error };
  const rows = ((data || []) as any[])
    .filter(a => a.is_academy && a.approved !== false && a.status !== 'removed' && (!visible || visible.has(a.id)));
  return { rows };
}

export async function loadCompletion(db: Db, visible: Set<string> | null, today: string): Promise<CompletionPayload | { error: unknown }> {
  const roster = await readRoster(db, visible);
  if ('error' in roster && roster.error) return { error: roster.error };
  const people = (roster as { rows: any[] }).rows;
  const ids = people.map(p => String(p.id));
  if (!ids.length) {
    return { rows: [], summary: { total: 0, ready: 0, missing: 0, needTest: 0, pending: 0 }, goalsStored: true };
  }

  const readTests = async (cols: string) => db.from('academy_tests').select(cols).in('athlete_id', ids).order('test_date', { ascending: false });
  const [testsRes, coachMap, goals] = await Promise.all([
    (async () => {
      let res: { data: any[] | null; error: unknown } = await readTests(TEST_COLS);
      // Before 108 there is no status: every row is the club's own, approved.
      if (res.error && isMissingColumn(res.error)) res = await readTests(TEST_COLS.replace(', status', ''));
      return res;
    })(),
    coachIdsByTrainee(db, undefined, people.map(p => ({ id: p.id, academy_coach_id: p.academy_coach_id ?? null }))),
    loadGoals(db, ids),
  ]);
  // No table yet (105) reads as nobody tested — which is the truth on that database.
  const tests = (testsRes.error ? [] : testsRes.data || []) as any[];

  const allCoachIds = [...new Set([...coachMap.values()].flat())];
  const coachNames = new Map<string, string>();
  if (allCoachIds.length) {
    const { data } = await db.from('athletes').select('id, name').in('id', allCoachIds);
    for (const c of (data || []) as any[]) coachNames.set(String(c.id), String(c.name || ''));
  }

  const byAthlete = new Map<string, any[]>();
  for (const t of tests) {
    const list = byAthlete.get(String(t.athlete_id));
    if (list) list.push(t); else byAthlete.set(String(t.athlete_id), [t]);
  }

  const inputs = people.map((p) => {
    const coachIds = coachMap.get(p.id) ?? [];
    return {
      athleteId: String(p.id),
      name: String(p.name || ''),
      tests: (byAthlete.get(p.id) ?? []) as StateRow[],
      bandNumber: p.academy_bands?.band_number ?? null,
      coachIds,
      coachNames: coachIds.map(id => coachNames.get(id) ?? ''),
      hasGoal: goals.goals.get(p.id)?.source !== 'none',
    };
  });
  const built = buildCompletion(inputs, today);
  const byId = new Map(people.map(p => [String(p.id), p]));
  const rows: CompletionPerson[] = built.rows.map((r) => {
    const mine = byAthlete.get(r.athleteId) ?? [];
    const approved = mine.find(t => (t.status ?? 'approved') === 'approved' && !t.excluded_reason);
    const pending = mine.find(t => t.status === 'pending');
    return {
      ...r,
      bandId: byId.get(r.athleteId)?.academy_band_id ?? null,
      coachIds: coachMap.get(r.athleteId) ?? [],
      goal: goals.goals.get(r.athleteId)!.goal,
      lastTest: approved ? view(approved) : null,
      pendingTest: pending ? view(pending) : null,
    };
  });
  return { rows, summary: built.summary, goalsStored: goals.stored };
}
