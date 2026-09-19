/**
 * The intake funnel: who is on the way into the academy, and what they are waiting for.
 *
 * Nine steps, four people responsible, and today the whole thing lives in one person's memory
 * and in WhatsApp history. The board this feeds has one job — "who is stuck, and with whom" —
 * and the two waits where candidates are actually lost are both invisible right now: the
 * characterization call nobody scheduled, and the test nobody ran.
 *
 * Three decisions here are the product, which is why they are in a tested module rather than
 * inside a component:
 *
 *  1. **A candidate sits in the stage they are WAITING FOR, not the one they last completed.**
 *     The board's columns are `ממתין לשיחת אפיון`, not `עשה שיחת היכרות`. Same rows either
 *     way; completely different question. "Who is waiting for me" is answerable, and the
 *     answer is the next phone call. "Who did the intro call" is a report.
 *
 *  2. **The wait is measured from the last thing that happened to that person**, not from the
 *     day they arrived. Counting from `created_at` makes every old candidate look stuck and
 *     the colour stops meaning anything by week three — which is exactly how the WhatsApp
 *     history fails today.
 *
 *  3. **Joining is not leaving.** Signing up to the platform is step 4 of 9: the athlete row
 *     exists while the test, the analysis, the first plan and the standing order are all still
 *     ahead. A funnel that ends at signup hides the half where people are lost.
 *
 * Pure: no clock, no database, no fetch. `today` is passed in, because a funnel that reads the
 * machine's clock cannot be tested for the one case that matters (the day somebody tips over
 * into stuck) and, at 02:00 in a +03:00 club, would disagree with the coach's own calendar.
 */

/** The nine steps, in the order the academy actually performs them. */
export type FunnelStage =
  /**
   * The registration form arrived.
   *
   * Stamped at creation for anybody who enters THROUGH the form, so they appear on the board
   * already waiting for the intro call. The `form` column is therefore the Instagram case
   * specifically: a DM came in, somebody opened a row by hand, and the form has not come back.
   */
  | 'form'
  /** Yossi's getting-to-know call. The deliberate selling point: a human, immediately. */
  | 'intro_call'
  /** Ofer's professional characterization call, which is also the input to the first plan. */
  | 'characterization'
  /** They signed up on the training platform and connected a watch. */
  | 'signup'
  /** The 30-minute test was actually run. */
  | 'test'
  /** The test was analysed: thresholds derived, band assigned, summary written. */
  | 'analysis'
  /** The first week of training exists. */
  | 'first_plan'
  /** Added to the two WhatsApp groups — their mentor's, and the academy's. */
  | 'whatsapp'
  /** The standing order is live, i.e. they are actually paying. */
  | 'standing_order';

/**
 * Who the board is waiting on. A ROLE and not a person: the academy has a manager who does
 * intake calls and a coach who does characterization and analysis, and staffing changes
 * without the funnel changing.
 *
 * `trainee` is the important one. Four of the nine steps are not the club's to do — the
 * candidate runs the test, connects the watch, sets up the standing order — and a board that
 * files those under "my tasks" tells the coach to chase himself.
 */
export type StageOwner = 'manager' | 'coach' | 'trainee';

export interface StageSpec {
  key: FunnelStage;
  /** The board column: what this candidate is waiting for. */
  waiting: string;
  /** The card's line once the step is done. */
  done: string;
  owner: StageOwner;
  /**
   * Days of silence after which this wait is stuck.
   *
   * GUESSES, every one, and they are the numbers most worth replacing with Ofer's own: a
   * threshold too low turns the board permanently red and a coach stops reading the colour,
   * which is a worse outcome than no colour at all. The shape of the guess is defensible even
   * if the values are not — the two CALLS are short (a candidate who filled in a form and
   * heard nothing for three days is a candidate cooling off, and the whole selling point is
   * the immediate human answer), and the two steps that need the trainee to physically do
   * something on a specific morning are long (a week to fit a 30-minute test around a life is
   * not negligence).
   */
  stuckAfterDays: number;
}

export const STAGES: readonly StageSpec[] = [
  { key: 'form', waiting: 'ממתין לטופס הרשמה', done: 'מילא טופס הרשמה', owner: 'trainee', stuckAfterDays: 4 },
  { key: 'intro_call', waiting: 'ממתין לשיחת היכרות', done: 'שיחת היכרות', owner: 'manager', stuckAfterDays: 2 },
  { key: 'characterization', waiting: 'ממתין לשיחת אפיון', done: 'שיחת אפיון', owner: 'coach', stuckAfterDays: 3 },
  { key: 'signup', waiting: 'ממתין להרשמה לפלטפורמה', done: 'נרשם לפלטפורמה', owner: 'trainee', stuckAfterDays: 4 },
  { key: 'test', waiting: 'ממתין לטסט 30 דקות', done: 'טסט 30 דקות', owner: 'trainee', stuckAfterDays: 7 },
  { key: 'analysis', waiting: 'ממתין לניתוח הטסט', done: 'ניתוח הטסט ושיבוץ דבוקה', owner: 'coach', stuckAfterDays: 2 },
  { key: 'first_plan', waiting: 'ממתין לתוכנית ראשונה', done: 'תוכנית אימונים ראשונה', owner: 'coach', stuckAfterDays: 3 },
  { key: 'whatsapp', waiting: 'ממתין לצירוף לקבוצות', done: 'צורף לקבוצות WhatsApp', owner: 'manager', stuckAfterDays: 2 },
  { key: 'standing_order', waiting: 'ממתין להוראת קבע', done: 'הוראת קבע', owner: 'trainee', stuckAfterDays: 5 },
] as const;

const SPEC = new Map<string, StageSpec>(STAGES.map(s => [s.key, s]));

/** A row of `academy_candidates`, as far as this cares. */
export interface CandidateRow {
  id: string;
  name: string;
  goal?: string | null;
  source?: string | null;
  /** Set at signup — step 4 — so this says nothing about being finished. */
  athleteId?: string | null;
  archivedAt?: string | null;
  archivedReason?: string | null;
  /** ISO. The clock starts here for the first stage. */
  createdAt: string;
}

/** A row of `academy_candidate_events`. */
export interface CandidateEvent {
  candidateId: string;
  /** A `FunnelStage`, or something a future migration wrote — see `buildFunnel`. */
  stage: string;
  occurredAt: string;
  recordedBy?: string | null;
  note?: string | null;
}

export type CandidateStatus =
  /** Still on the way in. */
  | 'live'
  /** All nine steps recorded: a trainee, not a candidate. Off the board. */
  | 'joined'
  /** Left without joining. Off the board, and NOT deleted. */
  | 'archived';

export interface FunnelCandidate {
  id: string;
  name: string;
  goal: string | null;
  source: string | null;
  status: CandidateStatus;
  /** The stage they are waiting for; `null` only when every stage is done. */
  waitingFor: FunnelStage | null;
  owner: StageOwner | null;
  /** ISO of the last thing that happened to them — the moment this wait began. */
  waitingSince: string;
  /** Whole days of silence, floored. Today is 0. */
  daysWaiting: number;
  /** Past this stage's threshold. Drives the one red thing on the board. */
  stuck: boolean;
  /** Completed stages, in funnel order. */
  done: FunnelStage[];
  archivedAt: string | null;
  archivedReason: string | null;
}

export interface FunnelColumn {
  spec: StageSpec;
  /** Stuck first, then longest wait first — the order to work through them. */
  candidates: FunnelCandidate[];
}

export interface FunnelBoard {
  columns: FunnelColumn[];
  /** Everybody on the board. */
  live: number;
  /** How many of those are past their stage's threshold. The header's second number. */
  stuck: number;
  joined: number;
  archived: number;
  /**
   * The ones who left, most recently first.
   *
   * The rows themselves and not just the count, because archiving is reversible — somebody who
   * said no in March and came back in September keeps every step they already did — and a
   * count alone leaves no way back. They are off the columns, so nothing about this puts them
   * in front of the coach's work.
   */
  archivedCandidates: FunnelCandidate[];
}

/**
 * Whole days between two ISO instants, floored, never negative.
 *
 * Floored rather than rounded because "stuck after 2 days" has to mean two full days have
 * passed. Clamped at zero because an `occurred_at` in the future is a typo in a date field —
 * a call logged as next Tuesday — and a negative wait would sort that row to the top of the
 * board as the most urgent thing in the academy.
 */
function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

/**
 * One candidate's position in the funnel.
 *
 * `waitingFor` is the first stage with no event, which is what makes an out-of-order history
 * readable: a test recorded before the characterization call leaves them waiting for the call,
 * because that is the step that is genuinely missing. `waitingSince` is the LATEST event of any
 * kind rather than the previous stage's, for the same reason — the wait began the last time
 * anything at all happened to this person.
 */
export function placeCandidate(
  candidate: CandidateRow,
  events: CandidateEvent[],
  nowISO: string,
): FunnelCandidate {
  const mine = events.filter(e => e.candidateId === candidate.id && SPEC.has(e.stage));

  // Earliest occurrence wins for a stage done twice: the step completed the first time.
  const completedAt = new Map<string, string>();
  for (const event of mine) {
    const seen = completedAt.get(event.stage);
    if (!seen || event.occurredAt < seen) completedAt.set(event.stage, event.occurredAt);
  }

  const done = STAGES.filter(s => completedAt.has(s.key)).map(s => s.key);
  const next = STAGES.find(s => !completedAt.has(s.key)) ?? null;

  const last = [...completedAt.values()].sort().pop();
  const waitingSince = last ?? candidate.createdAt;
  const daysWaiting = daysBetween(waitingSince, nowISO);

  const status: CandidateStatus = candidate.archivedAt
    ? 'archived'
    : next === null
      ? 'joined'
      : 'live';

  return {
    id: candidate.id,
    name: candidate.name,
    goal: candidate.goal ?? null,
    source: candidate.source ?? null,
    status,
    waitingFor: next?.key ?? null,
    owner: next?.owner ?? null,
    waitingSince,
    daysWaiting,
    // Only a live candidate can be stuck. An archived one is not waiting for anything, and
    // colouring them red would put the people who said no at the top of the board forever.
    stuck: status === 'live' && next !== null && daysWaiting >= next.stuckAfterDays,
    done,
    archivedAt: candidate.archivedAt ?? null,
    archivedReason: candidate.archivedReason ?? null,
  };
}

/**
 * The whole board.
 *
 * Columns come back for every stage, empty ones included, because an empty `ממתין לטסט` is
 * information — it is the shape of the funnel — and a board whose columns appear and disappear
 * as people move cannot be read at a glance twice.
 *
 * An event whose `stage` is not one of the nine is IGNORED rather than trusted. The table has
 * no CHECK constraint on purpose (the stage list is product and lives here), so an unknown key
 * is either a future stage this build does not know about or a typo, and treating it as
 * progress would mark a step complete that nobody performed.
 */
export function buildFunnel({
  candidates,
  events,
  now,
}: {
  candidates: CandidateRow[];
  events: CandidateEvent[];
  /** ISO instant to measure waits against. */
  now: string;
}): FunnelBoard {
  const placed = candidates.map(c => placeCandidate(c, events, now));
  const live = placed.filter(c => c.status === 'live');

  const columns = STAGES.map(spec => ({
    spec,
    candidates: live
      .filter(c => c.waitingFor === spec.key)
      // Stuck above not-stuck, then the longest wait: the order to make the calls in.
      .sort((a, b) =>
        Number(b.stuck) - Number(a.stuck) ||
        b.daysWaiting - a.daysWaiting ||
        a.name.localeCompare(b.name)),
  }));

  const archivedCandidates = placed
    .filter(c => c.status === 'archived')
    // Most recently gone first: the one worth a second look is the one who just said no, and
    // a row with no `archived_at` (archived by hand in SQL) sorts last rather than first.
    .sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));

  return {
    columns,
    live: live.length,
    stuck: live.filter(c => c.stuck).length,
    joined: placed.filter(c => c.status === 'joined').length,
    archived: archivedCandidates.length,
    archivedCandidates,
  };
}

export interface TimelineStep {
  spec: StageSpec;
  /** ISO when it completed, or `null` while it has not. */
  at: string | null;
  recordedBy: string | null;
  note: string | null;
  /** The step the candidate is waiting for right now — exactly one, or none when finished. */
  current: boolean;
}

/**
 * One candidate's card: all nine steps, in order, done or not.
 *
 * Every stage appears whether or not it happened, because the card's promise is that no step
 * disappears — the reason it can also serve as the trainee's history after they join. A card
 * that listed only completed steps would answer "what happened" and not "what is left", and
 * the second question is the one somebody opens this for.
 */
export function candidateTimeline(
  candidate: CandidateRow,
  events: CandidateEvent[],
): TimelineStep[] {
  const mine = events.filter(e => e.candidateId === candidate.id && SPEC.has(e.stage));
  const byStage = new Map<string, CandidateEvent>();
  for (const event of mine) {
    const seen = byStage.get(event.stage);
    if (!seen || event.occurredAt < seen.occurredAt) byStage.set(event.stage, event);
  }

  const next = STAGES.find(s => !byStage.has(s.key))?.key ?? null;
  const open = candidate.archivedAt ? null : next;

  return STAGES.map(spec => {
    const event = byStage.get(spec.key);
    return {
      spec,
      at: event?.occurredAt ?? null,
      recordedBy: event?.recordedBy ?? null,
      note: event?.note ?? null,
      current: spec.key === open,
    };
  });
}
