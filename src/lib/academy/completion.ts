// "השלמת פרטים" (mockup academy-existing-trainees, phone 1): who among the trainees already
// in the academy is missing what. Pure; GET /api/academy/completion reads the rows.
//
// Trainees like Shahar have trained in the academy for months, but their test, band, goal
// and coach live in a notebook or a WhatsApp thread — and without a test there are no
// personal paces and no load. This is the list that gets them in.
//
// "מוכן" (ready) = an approved 30-minute test younger than OLD_TEST_DAYS (120), a band, and a
// coach. The goal is wanted and never required: it shows as a chip, it does not block ready,
// and a trainee whose only gap is the goal is not counted in "חסרים" (they are under "הכל").
// A test waiting for approval is not a test yet (test-state.ts): the row says so and its
// action is "לאשר", because the next step is the coach's, not the trainee's.

import { testStateOf, type TestRow as StateRow, type TestState } from './test-state';

export type ItemKey = 'test' | 'band' | 'coach' | 'goal';

/** The test, as this list says it. */
export type TestGap = 'ok' | 'none' | 'pending' | 'otherProtocol' | 'old';

export interface CompletionInput {
  athleteId: string;
  name: string;
  tests: StateRow[];
  bandNumber: number | null;
  coachIds: string[];
  coachNames: string[];
  hasGoal: boolean;
}

export interface Chip {
  key: ItemKey;
  /** `missing` orange, `pending` blue, `have` green. */
  tone: 'missing' | 'pending' | 'have';
  /** For the test chip: which gap. For the band chip with `have`: its number. */
  gap?: TestGap;
  bandNumber?: number;
  /** The old test's date, for "טסט ישן · מאי". */
  date?: string;
}

export interface CompletionRow {
  athleteId: string;
  name: string;
  test: TestGap;
  testDate: string | null;
  bandNumber: number | null;
  coachNames: string[];
  hasGoal: boolean;
  /** Required items missing (test, band, coach). Empty = ready. */
  missing: ItemKey[];
  ready: boolean;
  /** Anything to fill in, the goal included. */
  incomplete: boolean;
  chips: Chip[];
  /** What the row's button does: open the form, or approve the waiting test. */
  action: 'complete' | 'approve';
}

export interface CompletionSummary {
  total: number;
  ready: number;
  /** total − ready: the "חסר משהו" list. */
  missing: number;
  /** No usable test at all (none / 2000 only / old) — whom "לבקש מכולם" asks. */
  needTest: number;
  pending: number;
}

/** The test as this list says it: an approved 30-minute test, old, waiting, 2000 only, or none. */
export function testGap(state: TestState): TestGap {
  // `old` exactly as the trainee's own screens decide it (test-state.ts, OLD_TEST_DAYS), so
  // this list and their "כדאי טסט חדש" never disagree about the same test.
  if (state.kind === 'ok') return state.old ? 'old' : 'ok';
  return state.kind;
}

const ORDER: ItemKey[] = ['test', 'band', 'coach', 'goal'];
/** Chips shown per row: every gap, then what they do have, to three. */
export const MAX_CHIPS = 3;
/**
 * The test chips with long labels ("טסט ישן · מאי", "רק טסט 2000", "טסט ממתין לאישור") take
 * two of the three places when the row is filled with what they have: three chips with one of
 * them did not fit the row's one line on a phone, and "מטרה" dropped to a line of its own.
 */
const LONG_TEST: ReadonlySet<TestGap> = new Set(['old', 'otherProtocol', 'pending']);

export function completionRow(input: CompletionInput, today: string): CompletionRow {
  const state = testStateOf(input.tests, today);
  const test = testGap(state);
  const testDate = state.kind === 'none' ? null : state.date;
  const missing: ItemKey[] = [];
  if (test !== 'ok') missing.push('test');
  if (input.bandNumber === null) missing.push('band');
  if (input.coachIds.length === 0) missing.push('coach');
  const gaps = input.hasGoal ? missing : [...missing, 'goal' as ItemKey];

  const chips: Chip[] = gaps.map((key) => key === 'test'
    ? { key, tone: test === 'pending' ? 'pending' : 'missing', gap: test, ...(testDate && test === 'old' ? { date: testDate } : {}) }
    : { key, tone: 'missing' });
  // What they have, to fill the row to three: the band (with its number) and the coach. Only
  // on a row that is missing something — a ready row has nothing to explain. Every gap is
  // shown before any of these; a long test chip leaves room for one less.
  if (gaps.length) {
    const room = MAX_CHIPS - (LONG_TEST.has(test) && gaps.includes('test') ? 1 : 0);
    if (input.bandNumber !== null && chips.length < room) chips.push({ key: 'band', tone: 'have', bandNumber: input.bandNumber });
    if (input.coachIds.length && chips.length < room) chips.push({ key: 'coach', tone: 'have' });
  }
  chips.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return {
    athleteId: input.athleteId,
    name: input.name,
    test,
    testDate,
    bandNumber: input.bandNumber,
    coachNames: input.coachNames,
    hasGoal: input.hasGoal,
    missing,
    ready: missing.length === 0,
    incomplete: gaps.length > 0,
    chips: chips.slice(0, MAX_CHIPS),
    // A waiting test with nothing else missing: the next step is the coach's approval.
    action: test === 'pending' && missing.length === 1 ? 'approve' : 'complete',
  };
}

export interface Completion {
  rows: CompletionRow[];
  summary: CompletionSummary;
}

/**
 * Every trainee's row, the incomplete first (most missing first, then by name), and the
 * counts the header says. `summary.missing === rows.filter(r => !r.ready).length`, always.
 */
export function buildCompletion(inputs: CompletionInput[], today: string): Completion {
  const rows = inputs.map(i => completionRow(i, today));
  rows.sort((a, b) => Number(a.ready) - Number(b.ready)
    || b.missing.length - a.missing.length
    || Number(a.hasGoal) - Number(b.hasGoal)
    || a.name.localeCompare(b.name));
  const ready = rows.filter(r => r.ready).length;
  return {
    rows,
    summary: {
      total: rows.length,
      ready,
      missing: rows.length - ready,
      needTest: rows.filter(r => r.test === 'none' || r.test === 'otherProtocol' || r.test === 'old').length,
      pending: rows.filter(r => r.test === 'pending').length,
    },
  };
}

// ── The approval card's check against the band (phone 5: "מול הדבוקה") ─────────────────

export type BandCheck =
  | { kind: 'inRange'; bandNumber: number }
  /** The pace sits nearest another band's threshold. */
  | { kind: 'nearer'; bandNumber: number; nearerNumber: number }
  /** Their band has no threshold pace recorded (pace_profile.thresholdPaceSec), so nothing to check against. */
  | { kind: 'noRanges'; bandNumber: number }
  | { kind: 'noBand' }
  /** A 2000 m (or other) test: it gives no threshold, so there is no pace to place. */
  | { kind: 'noPace' };

export interface CheckBand {
  id: string;
  bandNumber: number;
  thresholdPaceSec?: number | null;
}

/**
 * Which band's threshold this pace sits nearest, against the trainee's own band. Nearest (as
 * `recommendBand` in testAnalysis.ts), so a pace between two hand-written ranges still answers.
 */
export function bandCheck(paceSec: number | null, bandId: string | null, bands: CheckBand[]): BandCheck {
  const mine = bands.find(b => b.id === bandId) ?? null;
  if (!mine) return { kind: 'noBand' };
  if (paceSec === null) return { kind: 'noPace' };
  const withPace = bands.filter(b => typeof b.thresholdPaceSec === 'number' && b.thresholdPaceSec > 0);
  if (!withPace.length || !(typeof mine.thresholdPaceSec === 'number' && mine.thresholdPaceSec > 0)) {
    return { kind: 'noRanges', bandNumber: mine.bandNumber };
  }
  let best = withPace[0];
  for (const b of withPace.slice(1)) {
    if (Math.abs((b.thresholdPaceSec as number) - paceSec) < Math.abs((best.thresholdPaceSec as number) - paceSec)) best = b;
  }
  return best.id === mine.id
    ? { kind: 'inRange', bandNumber: mine.bandNumber }
    : { kind: 'nearer', bandNumber: mine.bandNumber, nearerNumber: best.bandNumber };
}
