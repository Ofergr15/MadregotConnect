import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { thresholdPaceSec } from './tests';
import { daysBetween } from './load';

/**
 * What the trainee's tests allow (missing-data rule: "צריך טסט כדי לחשב קצב").
 *
 * Every pace on the trainee's screens and every ⚡ stands on the newest APPROVED,
 * not-excluded 30-minute test (loadTestsFor / loadThresholds). Without one, a screen must
 * say which of these it is, never print a lane's pace as the trainee's own:
 *
 * - `none`: no test at all;
 * - `pending`: a test is in, waiting for the coach's approval. A 30-minute one newer than the
 *   approved test always; one of another protocol (a 2000 m) only when there is no CURRENT
 *   30-minute test — none approved, or an old one — since a 2000 m never gives a threshold:
 *   to a trainee without paces it is something already sent ("חסר לנו הטסט" again would ask
 *   for what is waiting), but in front of a recent 30-minute test it changes nothing, and
 *   the trainee stays `ok` (with `pendingOther`, so a screen can still say it is waiting).
 *   `protocol` says when it is not a 30-minute one;
 * - `otherProtocol`: only a 2000 m (or other) test. DECIDED: it does not stand in — the
 *   threshold is the 30-minute test's average pace, and a 2000 m effort is far above it,
 *   so its pace as a threshold would make every zone too fast. The screen asks for a
 *   30-minute test;
 * - `ok`: there is one; `old` once it is `OLD_TEST_DAYS` old ("כדאי טסט חדש").
 */
export type TestState =
  | { kind: 'ok'; date: string; ageDays: number; old: boolean; pendingOther?: { protocol: string; date: string } }
  | { kind: 'pending'; date: string; protocol?: string }
  | { kind: 'otherProtocol'; protocol: string; date: string }
  | { kind: 'none' };

/** About four months: the plan's paces were set for a body that has moved on. */
export const OLD_TEST_DAYS = 120;

export interface TestRow {
  test_date: string;
  protocol?: string | null;
  status?: string | null;
  excluded_reason?: string | null;
  duration_sec?: number | null;
  distance_m?: number | null;
}

export function testStateOf(rows: TestRow[], today: string): TestState {
  const sorted = [...rows].filter(r => !r.excluded_reason).sort((a, b) => String(b.test_date).localeCompare(String(a.test_date)));
  const usable = (r: TestRow) => {
    const pace = thresholdPaceSec({ durationSec: Number(r.duration_sec), distanceM: Number(r.distance_m) });
    return !!pace && pace > 0;
  };
  const thirty = sorted.filter(r => (r.protocol ?? '30min') === '30min' && usable(r));
  const approved = thirty.find(r => (r.status ?? 'approved') === 'approved');
  const isPending = (r: TestRow) => (r.status ?? 'approved') !== 'approved' && usable(r);
  const okOf = (row: TestRow): TestState => {
    const date = String(row.test_date).slice(0, 10);
    const ageDays = daysBetween(date, today);
    return { kind: 'ok', date, ageDays, old: ageDays >= OLD_TEST_DAYS };
  };
  // A newer 30-minute test waiting for approval is said even when an older one stands.
  const pendingThirty = thirty.find(r => (r.status ?? 'approved') !== 'approved');
  const pendingOther = sorted.find(r => (r.protocol ?? '30min') !== '30min' && isPending(r));
  if (pendingThirty && (!approved || String(pendingThirty.test_date) > String(approved.test_date))) {
    return { kind: 'pending', date: String(pendingThirty.test_date).slice(0, 10) };
  }
  const current = approved ? okOf(approved) : null;
  if (current && current.kind === 'ok' && !current.old) {
    // A 2000 m waiting in front of a recent 30-minute test: the paces stand, the trainee is ready.
    return pendingOther && String(pendingOther.test_date) > String(approved!.test_date)
      ? { ...current, pendingOther: { protocol: String(pendingOther.protocol), date: String(pendingOther.test_date).slice(0, 10) } }
      : current;
  }
  // No current 30-minute test: whatever was sent is what is waiting.
  if (pendingOther && (!approved || String(pendingOther.test_date) > String(approved.test_date))) {
    return { kind: 'pending', date: String(pendingOther.test_date).slice(0, 10), protocol: String(pendingOther.protocol) };
  }
  if (current) return current;
  const other = sorted.find(r => (r.protocol ?? '30min') !== '30min' && (r.status ?? 'approved') === 'approved');
  if (other) return { kind: 'otherProtocol', protocol: String(other.protocol), date: String(other.test_date).slice(0, 10) };
  return { kind: 'none' };
}

/**
 * The "הערכה לפי דופק" line's key under a number standing on heart rate, by what the tests
 * are: a test waiting for the coach is not "עוד אין טסט", and neither is a 2000 m one —
 * the line must agree with the test line above it.
 */
export type HrEstimateKey = 'hrEstimate' | 'hrEstimatePending' | 'hrEstimateOther' | 'hrEstimateOk';
export function hrEstimateKey(kind: TestState['kind'] | null | undefined): HrEstimateKey {
  switch (kind) {
    case 'pending': return 'hrEstimatePending';
    case 'otherProtocol': return 'hrEstimateOther';
    case 'ok': return 'hrEstimateOk';
    default: return 'hrEstimate';
  }
}

/** A pending test in front of an approved one still has paces: only the lack of one blocks them. */
export const hasPaces = (s: TestState) => s.kind === 'ok';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** One trainee's tests, every protocol and status, decided. A read error reads as "none". */
export async function loadTestState(db: Db, athleteId: string, today: string): Promise<TestState> {
  try {
    const read = (cols: string) => db.from('academy_tests').select(cols).eq('athlete_id', athleteId).order('test_date', { ascending: false }).limit(20);
    let { data, error }: { data: any[] | null; error: unknown } = await read('test_date, protocol, status, excluded_reason, duration_sec, distance_m');
    if (error && isMissingColumn(error)) ({ data, error } = await read('test_date, protocol, excluded_reason, duration_sec, distance_m'));
    if (error || !data) return { kind: 'none' };
    return testStateOf(data as TestRow[], today);
  } catch {
    return { kind: 'none' };
  }
}
