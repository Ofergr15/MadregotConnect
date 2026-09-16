import type { TraineeFeedback } from '@/components/academy/FeedbackCard';

// ── The academy thread, and the order of the inbox ──────────────────────────
//
// The club's feedback loop lives in WhatsApp today, which is why a decision made
// in March is unfindable in September. This moves it into a thread the app owns —
// but NOT into a new messages table. `src/lib/run-chat/` is already a working
// multi-party Stream Chat thread (runner + coach + AI, with mentions, realtime and
// rich attachments), and migration 088 in this repo is the cautionary tale about
// what happens when the same thing lives in two places: kudos drifted until one
// run showed 0 likes and 3 kudos. So the academy thread is a Stream channel like
// the run chats, on a different key.
//
// The key is the TRAINEE, not the workout. A thread per workout turns one
// relationship into forty dead threads and makes "what did we agree about your
// knee" unfindable — which is the exact failure being migrated away from. One
// thread per trainee, for as long as they are in the academy.

/**
 * The channel for one trainee's academy thread.
 *
 * Deliberately parallel to `run-chat`'s `run-${activityId}` and in the same
 * `messaging` channel type, so one Stream app, one token mint, and one set of
 * message components serve both.
 */
export function academyChannelId(athleteId: string): string {
  return `academy-${athleteId}`;
}

export const ACADEMY_FEEDBACK_VERSION = 1;

/**
 * The weekly review, posted into the thread.
 *
 * Carries the STRUCTURED feedback, not the rendered Hebrew, so the thread and the
 * activity page render the identical `FeedbackCard` from one payload. Posting the
 * rendered text instead would give the trainee two different-looking versions of
 * one review and re-open the "which one is the real feedback" question.
 *
 * Versioned like `strava_run` and `tool_trace` beside it: a message a trainee
 * already received must keep rendering after the shape changes.
 */
export type AcademyFeedbackAttachment = {
  type: 'academy_feedback';
  version: number;
  /** The reviewed day, so the card can deep-link to the run it is about. */
  workout_date: string;
  activity_id: string | null;
  workout_name: string | null;
  feedback: TraineeFeedback;
};

/**
 * Why a thread is in front of you.
 *
 * `no_feedback` is deliberately NOT here. "Who still needs this week's review" is
 * the weekly queue's question and it already answers it, ranked. Repeating it here
 * would give two screens the same job and let them disagree — which is how the
 * kudos tables drifted. This inbox answers exactly one different question: who is
 * waiting on a human reply.
 */
export type InboxReason = 'awaiting_reply' | 'silent' | 'unread' | 'quiet';

/**
 * How long a thread can go quiet in both directions before it is a problem.
 *
 * A GUESS, like the ±10 s/km tolerance was, and editable in one place for the same
 * reason: ten days is two missed weekly touches, which felt like the point where a
 * relationship has stopped rather than paused. Ofer's number replaces it.
 */
export const SILENT_DAYS = 10;

/** What the caller must know about one trainee's thread to rank it. */
export interface ThreadSnapshot {
  athleteId: string;
  name: string;
  /** The trainee's last message, ISO. Null = they have never written. */
  lastTraineeMessageAt: string | null;
  /** The last message from ANY staff seat — coach or manager. Null = never. */
  lastStaffMessageAt: string | null;
  /** Unread for the person looking, straight from Stream. */
  unreadCount: number;
}

export interface InboxRow extends ThreadSnapshot {
  reason: InboxReason;
  /**
   * Hours the trainee has been waiting on an answer, for `awaiting_reply`. Null
   * for every other reason — a thread nobody asked anything in is not "waiting 0
   * hours", and printing 0 there would read as "just answered".
   */
  waitingHours: number | null;
  /** Days since anyone spoke at all, for `silent`. Null otherwise. */
  quietDays: number | null;
  urgency: number;
}

/**
 * Bands, not weights.
 *
 * Multiplied by 1e6 with the in-band magnitude capped below that, so no amount of
 * waiting can lift an `unread` past a `silent`, and no volume of unread chatter can
 * bury a trainee whose question went unanswered. Same construction as
 * `lib/academy/queue.ts`, for the same reason: a row in the wrong place here is a
 * person who does not get answered.
 */
const BAND: Record<InboxReason, number> = {
  awaiting_reply: 4,
  silent: 3,
  unread: 2,
  quiet: 1,
};

const MAX_MAGNITUDE = 999_999;

function hoursBetween(fromIso: string, now: number): number {
  const then = new Date(fromIso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / 3_600_000);
}

/**
 * Is the trainee waiting on us?
 *
 * True when they spoke last. A staff message that PREDATES their question does not
 * count as an answer, which is the whole point — "I replied last week" is not a
 * reply to what they asked yesterday.
 */
export function awaitingReply(s: ThreadSnapshot): boolean {
  if (!s.lastTraineeMessageAt) return false;
  if (!s.lastStaffMessageAt) return true;
  return new Date(s.lastStaffMessageAt).getTime() < new Date(s.lastTraineeMessageAt).getTime();
}

/** The most recent message either way, or null in a thread nobody has used. */
export function lastActivityAt(s: ThreadSnapshot): string | null {
  const times = [s.lastTraineeMessageAt, s.lastStaffMessageAt].filter(Boolean) as string[];
  if (!times.length) return null;
  return times.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b));
}

export function classify(s: ThreadSnapshot, now: number): InboxReason {
  if (awaitingReply(s)) return 'awaiting_reply';
  const last = lastActivityAt(s);
  // A thread nobody has ever written in counts as silent, not quiet: a trainee who
  // has never once been spoken to in their own thread is the strongest version of
  // the problem this screen exists to surface, not the absence of one.
  if (!last) return 'silent';
  if (hoursBetween(last, now) / 24 >= SILENT_DAYS) return 'silent';
  if (s.unreadCount > 0) return 'unread';
  return 'quiet';
}

export function rank(s: ThreadSnapshot, now: number): InboxRow {
  const reason = classify(s, now);
  const last = lastActivityAt(s);

  const waitingHours = reason === 'awaiting_reply' && s.lastTraineeMessageAt
    ? hoursBetween(s.lastTraineeMessageAt, now)
    : null;
  // A never-used thread has no "days since" to report. Ranked at the top of its own
  // band rather than given a fake age.
  const quietDays = reason === 'silent'
    ? (last ? hoursBetween(last, now) / 24 : null)
    : null;

  let magnitude = 0;
  if (reason === 'awaiting_reply') magnitude = waitingHours ?? 0;
  else if (reason === 'silent') magnitude = quietDays == null ? MAX_MAGNITUDE : quietDays;
  else if (reason === 'unread') magnitude = s.unreadCount;

  return {
    ...s,
    reason,
    waitingHours,
    quietDays,
    urgency: BAND[reason] * 1e6 + Math.min(Math.round(magnitude), MAX_MAGNITUDE),
  };
}

export interface Inbox {
  rows: InboxRow[];
  counts: Record<InboxReason, number>;
  /** Threads that need a person. The number worth putting on a badge. */
  needsAttention: number;
}

/**
 * The inbox, ordered.
 *
 * Nothing downstream re-sorts. A row in the wrong place means a wrong rule here,
 * which is where it is written down and pinned by tests — not a stray comparator in
 * a component.
 */
export function buildInbox(snapshots: ThreadSnapshot[], nowIso?: string): Inbox {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const rows = snapshots
    .map(s => rank(s, now))
    .sort((x, y) => y.urgency - x.urgency || x.name.localeCompare(y.name, 'he'));

  const counts: Record<InboxReason, number> = {
    awaiting_reply: 0, silent: 0, unread: 0, quiet: 0,
  };
  for (const r of rows) counts[r.reason] += 1;

  return {
    rows,
    counts,
    // Deliberately excludes `unread`: unread is "there is something to read", which
    // the bell already means. This number is "somebody is waiting on you", and a
    // badge that mixes the two is a badge nobody trusts.
    needsAttention: counts.awaiting_reply + counts.silent,
  };
}
