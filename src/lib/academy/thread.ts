import type { TraineeFeedback } from '@/components/academy/FeedbackCard';
import type { ThreadMessage, ThreadSeat } from '@/components/academy/ThreadTranscript';

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

/**
 * The shape of a Stream message, reduced to what ranking needs.
 *
 * `created_at` takes a Date as well as a string because Stream's own channel state
 * hands back Dates while its REST payloads hand back ISO strings, and the snapshot
 * has to be ISO either way.
 */
export interface ThreadMessageRef {
  created_at?: string | Date | null;
  user?: { id?: string | null } | null;
  user_id?: string | null;
}

/**
 * Turn a channel's recent messages into a snapshot.
 *
 * Everyone who is not the trainee is staff. That is not a shortcut — there is no
 * academy-manager role in this app (`STAFF_ROLES` is admin/coach/academy_coach and
 * the mentor link is `athletes.academy_coach_id`), so "manager" is a seat in the UI
 * and not a permission tier. For the one question this inbox asks — is somebody
 * waiting on a human reply — the coach and the manager are the same side.
 *
 * SAFE ON A TRUNCATED WINDOW, which matters because the caller passes the last N
 * messages and not the whole thread. If staff last spoke before the window,
 * `lastStaffMessageAt` comes back null and `awaitingReply` reads the thread as
 * awaiting — which is the right answer, because the trainee did speak last. The
 * classification only ever depends on WHO the newest message is from and how old it
 * is, and the newest message is always inside the window.
 */
export function snapshotFromMessages(
  athleteId: string,
  name: string,
  messages: ThreadMessageRef[],
  unreadCount: number,
): ThreadSnapshot {
  let lastTraineeMessageAt: string | null = null;
  let lastStaffMessageAt: string | null = null;

  for (const m of messages) {
    if (!m.created_at) continue;
    const stamp = new Date(m.created_at);
    if (Number.isNaN(stamp.getTime())) continue;
    const at = stamp.toISOString();
    const author = m.user?.id ?? m.user_id ?? null;
    const isTrainee = author === athleteId;
    const slot = isTrainee ? lastTraineeMessageAt : lastStaffMessageAt;
    // Not assuming the caller sorted them: Stream returns oldest-first here and
    // newest-first elsewhere, and a wrong "who spoke last" is the one error this
    // whole screen is built to avoid.
    if (!slot || new Date(at).getTime() > new Date(slot).getTime()) {
      if (isTrainee) lastTraineeMessageAt = at;
      else lastStaffMessageAt = at;
    }
  }

  return { athleteId, name, lastTraineeMessageAt, lastStaffMessageAt, unreadCount };
}

/** A Stream message, reduced to what the transcript renders. */
export interface StreamMessageLike extends ThreadMessageRef {
  id?: string | null;
  text?: string | null;
  user?: { id?: string | null; name?: string | null } | null;
  /** The review, carried as a custom field on the message. */
  academy_feedback?: AcademyFeedbackAttachment | null;
}

/**
 * Which seat wrote a message.
 *
 * Note what is NOT consulted: the author's role. A coach who is also this trainee's
 * mentor and an admin who is not are told apart by the PAIRING, not by their
 * permissions — `academy_coach_id` is the mentor link, and every other staff seat in
 * the thread is there as the manager. Reading `role` instead would label the club's
 * head coach "manager" in a thread where he is personally the mentor, which is the
 * one distinction the bubble exists to make.
 */
export function seatFor(
  authorId: string | null,
  athleteId: string,
  mentorId: string | null,
): ThreadSeat {
  if (authorId && authorId === athleteId) return 'trainee';
  if (mentorId && authorId === mentorId) return 'coach';
  return 'manager';
}

/**
 * Map a channel's messages into the transcript's shape, oldest first.
 *
 * Deleted messages are dropped rather than rendered as tombstones: this thread is a
 * coaching record, and "this message was deleted" between a question and its answer
 * invites the trainee to wonder what was taken back.
 */
export function toThreadMessages(
  messages: StreamMessageLike[],
  { athleteId, mentorId }: { athleteId: string; mentorId: string | null },
): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const m of messages) {
    if (!m.id || !m.created_at) continue;
    const stamp = new Date(m.created_at);
    if (Number.isNaN(stamp.getTime())) continue;
    const authorId = m.user?.id ?? m.user_id ?? null;
    const feedback = m.academy_feedback ?? null;
    const text = (m.text ?? '').trim();
    // A message with neither text nor a card has nothing to show. Skipped instead of
    // rendering an empty bubble, which reads as a failed send.
    if (!text && !feedback) continue;
    out.push({
      id: m.id,
      // Stream carries "Name · role" as the display name; the seat already conveys the
      // role here, and repeating it puts "יוסי · מאמן" next to a coach badge.
      authorName: (m.user?.name ?? '').split(' · ')[0] || authorId || '',
      seat: seatFor(authorId, athleteId, mentorId),
      text,
      at: stamp.toISOString(),
      feedback,
    });
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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
