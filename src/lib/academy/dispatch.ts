/**
 * "Did the workout we sent actually reach the athlete, and did they run it?"
 *
 * The push side of this question was already answered honestly (see
 * `lib/garmin/delivery.ts`): a verified push proves *Garmin's account* holds the
 * workout on the day we asked for. This module is the return half — reconciling
 * what we sent against what came back — and its whole job is to keep three very
 * different situations from being printed as the same sentence.
 *
 * The mockup this implements ("שליחה לשעונים") asks for a column headed "confirmed
 * on the watch", filled in minutes after the send. Two things about how Garmin
 * actually works mean that column cannot be written as drawn, and pretending
 * otherwise would put a green tick next to an athlete who has nothing:
 *
 *  1. **No endpoint reports "device X now holds workout Y."** The watch pulls from
 *     Garmin's cloud on its own schedule, with its own credentials, and never tells
 *     us it did. The earliest moment we learn the workout reached the device is
 *     when an ACTIVITY comes back stamped with its `workoutId` — i.e. after the
 *     athlete has run it. `device_confirmed_at` (migration 092) is that moment. So
 *     the honest heading is "ran it", not "has it", and there is a real gap in
 *     between where the truthful answer is "we cannot know yet".
 *
 *  2. **Our token dying does not stop their watch.** `athletes.garmin_auth` is our
 *     session on the athlete's account; if it expires, *we* can no longer write —
 *     which shows up immediately as a failed push, not as a silent watch. The
 *     mockup's red box ("sent fine, then the connection expired, so he has no
 *     workout") describes something that cannot happen in that direction.
 *
 * What a broken Garmin connection DOES cause is the thing worth a red box, and it
 * is the opposite of what the mockup guessed: it makes us **blind on the way back**.
 * If the athlete's activities have stopped arriving, then a missing
 * `device_confirmed_at` is not evidence that they skipped the session — it is
 * evidence that we cannot see. `blind` exists so that case never gets reported as
 * `no_run`, because accusing someone who ran of skipping is the one output of this
 * screen that would cost the coach the trainee's trust.
 *
 * Pure below the imports — the one value import, `classifyDeliveryFailure`, is itself a pure
 * function of an error string — so every one of these distinctions is testable without a
 * database, a Garmin account, or a clock. It is imported rather than reimplemented because
 * the send path uses the same function to decide whether the athlete gets told their watch
 * is disconnected, and a second copy of that judgement is how the screen and the phone start
 * disagreeing about whose fault a failure is.
 */

import { classifyDeliveryFailure, type DeliveryFailureBlame } from '../garmin/delivery-failure';
import type { ConnectionState } from '../providers/health';

export type DispatchState =
  /** Nothing was ever recorded for this slot — the plan was never pushed. */
  | 'not_sent'
  /** The push threw. `detail` carries Garmin's own words. Actionable. */
  | 'send_failed'
  /**
   * Garmin issued a workout id but the batch was never verified on the account
   * (`status: 'pending'`). The workout may well be there; we did not prove it, and
   * `push-workouts` deliberately refuses to call that a success. Actionable: a
   * re-push both cleans up the orphan and settles the question.
   */
  | 'unconfirmed'
  /** Verified on the Garmin account, and the day has not arrived yet. Nothing to do. */
  | 'on_account'
  /**
   * An activity came back carrying this workout's id. The only state that proves
   * the watch received it, and the strongest evidence this system can produce.
   */
  | 'ran_from_it'
  /**
   * The day has passed, the workout was on the account, and the athlete DID run —
   * but the run carries no workout id, so they started it freestyle rather than
   * from the workout on the watch. Not a delivery failure and not a missed
   * session: it is the state that means "the structure never reached them", which
   * is worth one conversation and no alarm.
   */
  | 'ran_freestyle'
  /**
   * The day has passed, the workout was on the account, and no run arrived at all.
   * Only ever reported when we can actually see this athlete's activities — see
   * `blind`.
   */
  | 'no_run'
  /**
   * The day has passed and we have no idea, because this athlete's activity feed
   * is not reaching us (credential refused, or nothing synced in a fortnight). Not
   * a verdict on the athlete. Actionable, and the action is a reconnect.
   */
  | 'blind';

/** A `workout_deliveries` row, as far as this cares. */
export interface DeliveryRow {
  athlete_id: string;
  workout_date: string;
  status: string | null;
  error_message?: string | null;
  garmin_workout_id?: string | null;
  device_confirmed_at?: string | null;
  created_at?: string | null;
}

export interface DispatchAthlete {
  id: string;
  name: string;
  /**
   * From `connectionState()`. `'unknown'` is the pre-migration-101 answer and must
   * NOT be treated as broken — a fresh deploy would otherwise report the whole
   * academy as blind.
   */
  connection: ConnectionState;
}

export interface DispatchRow {
  athleteId: string;
  name: string;
  /** The date the workout was scheduled for. */
  date: string;
  state: DispatchState;
  /** When we pushed it, when the row records that. */
  sentAt: string | null;
  /** When an activity first came back carrying its id. */
  confirmedAt: string | null;
  /** Garmin's own error text on a failure — never paraphrased. */
  detail: string | null;
  /**
   * On `send_failed`: whose problem it is.
   *
   * The mockup calls the failure row the critical one, and what it asks for is not just WHO
   * did not receive the week but WHY — because the two answers lead to opposite actions.
   * `'ours'` means press the button again. `'reconnect'` means pressing it again will fail
   * identically until the athlete relinks their watch, and the coach's job is a message to
   * that person, not a retry.
   *
   * `detail` already carried the raw text, which is the honest record and unreadable as a
   * decision: "Request failed with status code 401" does not tell a coach at a glance that
   * this one is not theirs to fix. `null` on every state that is not a send failure.
   *
   * It is also what makes the screen agree with the athlete's phone. `push-workouts` sends
   * the athlete a "reconnect your watch" notification on exactly this classification, so a
   * row marked `'reconnect'` is precisely a row where they have already been told.
   */
  blame: DeliveryFailureBlame | null;
  connection: ConnectionState;
  /** Whether this row is asking the coach to do something. Drives the red box. */
  actionable: boolean;
}

export interface DispatchSummary {
  /** Slots we pushed and verified on the account, `ran_from_it` included. */
  onAccount: number;
  /** Slots proven to have reached a device, because a run came back from one. */
  ranFromIt: number;
  /**
   * Slots with no workout we can vouch for: `send_failed` + `not_sent` +
   * `unconfirmed`. Deliberately ALL THREE, and deliberately not `blind`, so this
   * is exactly `needsAttention` minus the blind rows — the screen shows this number
   * next to a box that names those same people, and the two disagreeing is worse
   * than either being slightly broad. The screenshot caught that: a KPI reading 2
   * beside a box naming 3 people, because `not_sent` was in one and not the other.
   */
  unconfirmed: number;
  /** `blind` — we cannot see this athlete's runs, so we are not judging them. */
  blind: number;
}

export interface DispatchReport {
  rows: DispatchRow[];
  summary: DispatchSummary;
  /** Rows the coach should act on, already in the order to read them. */
  needsAttention: DispatchRow[];
}

/**
 * Which of several rows for one slot is the truth.
 *
 * A re-push inserts a new row rather than updating the old one, so one (athlete,
 * date) slot routinely holds a failure followed by a success, and `push-workouts`
 * also writes a `pending` row for every workout Garmin took before the batch is
 * verified. Highest evidence wins rather than newest, because these rows all
 * describe the SAME intended session and a later attempt cannot un-deliver an
 * earlier one: if any attempt got the workout onto the account, the athlete has
 * it, and reporting the failed first try would send the coach to re-push
 * something that is already there.
 */
const EVIDENCE: Record<string, number> = { failed: 1, pending: 2, success: 3 };

function rank(row: DeliveryRow): number {
  // A confirmed run outranks everything — it is proof, not a status we wrote.
  if (row.device_confirmed_at) return 4;
  return EVIDENCE[String(row.status ?? '')] ?? 0;
}

/**
 * True when this athlete's runs are not reaching us, so their execution cannot be
 * observed either way.
 *
 * `stale` counts alongside `failed`: a fortnight with nothing synced (the
 * threshold `providers/health.ts` picked so as not to accuse people of a broken
 * watch when they took a week off) means we would not have seen the activity even
 * if they ran the workout perfectly. `none` counts too — an athlete with no Garmin
 * credential at all can still be *sent* nothing and, more to the point, can never
 * return a `workoutId`, so every past slot of theirs would otherwise read `no_run`
 * forever.
 */
function cannotSeeActivities(connection: ConnectionState): boolean {
  return connection === 'failed' || connection === 'stale' || connection === 'none';
}

/**
 * The states that put a row in front of the coach.
 *
 * `no_run` and `ran_freestyle` are deliberately NOT here. Both are real
 * information, and neither is a dispatch problem the coach can fix from this
 * screen — a screen that cries about every athlete who ran their long run
 * freestyle is a screen nobody opens twice.
 */
const ACTIONABLE = new Set<DispatchState>(['send_failed', 'unconfirmed', 'blind', 'not_sent']);

export interface DispatchInput {
  /** The academy roster in scope, with each athlete's connection health. */
  athletes: DispatchAthlete[];
  /** Every `workout_deliveries` row for the week being reported on. */
  deliveries: DeliveryRow[];
  /**
   * `${athleteId}:${date}` for every day an activity was recorded. Used ONLY to
   * separate "ran it freestyle" from "did not run", which is the difference
   * between a coaching conversation and a missed session.
   */
  activityDays: ReadonlySet<string>;
  /**
   * The dates the plan asked for, per athlete — so a slot that was never pushed
   * at all can be reported. Omit an athlete to report only what was pushed for
   * them, which is what a coach browsing a past week wants.
   */
  expected?: Map<string, string[]>;
  /** Anything on or after this date is still in the future. `YYYY-MM-DD`. */
  today: string;
}

/** `${athleteId}:${date}` — the slot key, and the shape `activityDays` uses. */
export function slotKey(athleteId: string, date: string): string {
  return `${athleteId}:${date}`;
}

function stateFor(
  best: DeliveryRow | undefined,
  athlete: DispatchAthlete,
  date: string,
  activityDays: ReadonlySet<string>,
  today: string,
): DispatchState {
  if (!best) return 'not_sent';
  if (best.device_confirmed_at) return 'ran_from_it';

  const status = String(best.status ?? '');
  if (status === 'failed') return 'send_failed';
  if (status !== 'success') return 'unconfirmed';

  // Verified on the account. Everything from here is about the return trip, and a
  // day that has not happened yet has no return trip to report. Compared as
  // strings because both are `YYYY-MM-DD`, which sorts correctly and sidesteps the
  // timezone question entirely — the alternative, parsing both into Dates, is how
  // a workout scheduled for today reads as overdue at 02:00 in a +03:00 club.
  if (date >= today) return 'on_account';

  if (cannotSeeActivities(athlete.connection)) return 'blind';
  return activityDays.has(slotKey(athlete.id, date)) ? 'ran_freestyle' : 'no_run';
}

/**
 * Reconcile a week of pushes against what came back.
 *
 * Rows come out in reading order: everything actionable first (in the order
 * `ACTIONABLE` is worth acting on — a failed send before a merely unproven one),
 * then the rest by date and name. `needsAttention` is the same actionable rows,
 * handed over separately so the screen's red box and its table cannot disagree
 * about who is in trouble.
 */
export function buildDispatchReport({
  athletes,
  deliveries,
  activityDays,
  expected,
  today,
}: DispatchInput): DispatchReport {
  const byId = new Map(athletes.map(a => [a.id, a]));

  // Best row per slot, and the earliest send we saw for it. `created_at` comes
  // from the winning row where it has one, but a re-push's success is not when the
  // athlete's watch could first have seen the workout — the first attempt is — so
  // the earliest is the honest "sent at".
  const best = new Map<string, DeliveryRow>();
  const firstSentAt = new Map<string, string>();
  for (const row of deliveries) {
    if (!byId.has(row.athlete_id) || !row.workout_date) continue;
    const key = slotKey(row.athlete_id, row.workout_date);

    const existing = best.get(key);
    if (!existing || rank(row) > rank(existing)) best.set(key, row);

    if (row.created_at) {
      const seen = firstSentAt.get(key);
      if (!seen || row.created_at < seen) firstSentAt.set(key, row.created_at);
    }
  }

  // Every slot worth a row: the ones we pushed, plus any the plan expected and we
  // did not. A slot nobody asked for and nobody pushed is not a gap.
  const slots = new Set(best.keys());
  for (const [athleteId, dates] of expected ?? []) {
    if (!byId.has(athleteId)) continue;
    for (const date of dates) slots.add(slotKey(athleteId, date));
  }

  const rows: DispatchRow[] = [];
  for (const key of slots) {
    const separator = key.indexOf(':');
    const athleteId = key.slice(0, separator);
    const date = key.slice(separator + 1);
    const athlete = byId.get(athleteId);
    if (!athlete) continue;

    const row = best.get(key);
    const state = stateFor(row, athlete, date, activityDays, today);
    rows.push({
      athleteId,
      name: athlete.name,
      date,
      state,
      sentAt: firstSentAt.get(key) ?? row?.created_at ?? null,
      confirmedAt: row?.device_confirmed_at ?? null,
      // Only ever the failure's own text. A `pending` row has no error to show —
      // the whole point of `unconfirmed` is that nothing told us anything.
      detail: state === 'send_failed' ? (row?.error_message ?? null) : null,
      // Read off the same text, by the same function the send path uses to decide whether
      // the athlete gets told. One classifier, so the screen and the phone cannot disagree.
      blame: state === 'send_failed' ? classifyDeliveryFailure(row?.error_message) : null,
      connection: athlete.connection,
      actionable: ACTIONABLE.has(state),
    });
  }

  // The two states that mean "there is no workout on that watch" come first and
  // adjacently — `send_failed` (we tried, Garmin refused) and `not_sent` (nobody
  // ever tried). They wear the same colour for the same reason, and separating them
  // with the milder states put two red rows either side of two calm ones, which
  // reads as three unrelated problems instead of one list ordered by severity.
  const ORDER: DispatchState[] = ['send_failed', 'not_sent', 'unconfirmed', 'blind'];
  const priority = (state: DispatchState) => {
    const index = ORDER.indexOf(state);
    return index === -1 ? ORDER.length : index;
  };
  rows.sort((a, b) =>
    priority(a.state) - priority(b.state) ||
    a.date.localeCompare(b.date) ||
    a.name.localeCompare(b.name));

  const count = (...states: DispatchState[]) => rows.filter(r => states.includes(r.state)).length;

  return {
    rows,
    summary: {
      onAccount: count('on_account', 'ran_from_it', 'ran_freestyle', 'no_run', 'blind'),
      ranFromIt: count('ran_from_it'),
      unconfirmed: count('send_failed', 'not_sent', 'unconfirmed'),
      blind: count('blind'),
    },
    needsAttention: rows.filter(r => r.actionable),
  };
}
