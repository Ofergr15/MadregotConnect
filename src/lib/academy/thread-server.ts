import type { StreamChat } from 'stream-chat';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CHANNEL_TYPE, upsertStreamUsersFromAthletes } from '@/lib/stream/server';
import {
  ACADEMY_FEEDBACK_VERSION,
  academyChannelId,
  type AcademyFeedbackAttachment,
} from './thread';
import type { TraineeFeedback } from '@/components/academy/FeedbackCard';

// ── The academy thread, server side ─────────────────────────────────────────
//
// Everything that talks to Stream. Kept out of `thread.ts` so the ranking module
// stays pure and importable by the audit harness and by tests — the split is load-
// bearing, not tidiness.

/**
 * Who sits in a trainee's thread.
 *
 * Three seats, and the third one needs stating plainly: there is no academy-manager
 * role in this app. `STAFF_ROLES` is admin/coach/academy_coach and the mentor link is
 * `athletes.academy_coach_id`, so "manager" is a seat in the UI, not a permission
 * tier — which means the manager seat is filled by EVERY admin. That is a real
 * consequence of the club's role model and not a decision this function can make;
 * it is written down here because the alternative is discovering it from a trainee.
 *
 * The AI coach is deliberately NOT a member. The run chats include it because a run
 * is a thing to analyse; this thread is the human relationship the club currently
 * conducts over WhatsApp, and adding a bot to it changes what it is.
 */
export async function academyThreadMembers(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<string[]> {
  const members = new Set<string>([athleteId]);

  const { data: trainee } = await supabase
    .from('athletes')
    .select('academy_coach_id')
    .eq('id', athleteId)
    .maybeSingle();
  if (trainee?.academy_coach_id) members.add(trainee.academy_coach_id);

  // `academy_coach_id` points at athletes.id, unlike run-chat's `coach_id` which
  // points at coaches.id and needs resolving across two identity spaces by email.
  // One less place for those to disagree.
  const { data: admins } = await supabase
    .from('athletes')
    .select('id, role')
    .eq('role', 'admin');
  for (const a of admins || []) if (a.id) members.add(a.id);

  return [...members].filter(Boolean);
}

/**
 * Find-or-create the trainee's thread, and make sure everyone who belongs is in it.
 *
 * Idempotent, and called on every open rather than once at signup: membership
 * changes when the manager reassigns a mentor, and a thread whose membership was
 * frozen at creation would leave the new mentor unable to read the history they
 * just inherited.
 */
export async function ensureAcademyThread(
  stream: StreamChat,
  supabase: SupabaseClient,
  athleteId: string,
  openedByStreamId?: string | null,
) {
  const members = await academyThreadMembers(supabase, athleteId);
  if (openedByStreamId) members.push(openedByStreamId);
  const unique = [...new Set(members)];

  // Names and avatars, so the transcript shows people and not initials.
  await upsertStreamUsersFromAthletes(stream, supabase, unique);

  const id = academyChannelId(athleteId);
  const channel = stream.channel(CHANNEL_TYPE, id, {
    members: unique,
    created_by_id: openedByStreamId || unique[0],
  } as Record<string, unknown>);

  try {
    await channel.create();
  } catch {
    // Already exists. The addMembers below is what actually matters on this path.
  }
  try {
    await channel.addMembers(unique);
  } catch {
    // Existing members are harmless; a real failure surfaces on the caller's watch.
  }

  return { channel, channelId: id, cid: `${CHANNEL_TYPE}:${id}`, members: unique };
}

/**
 * The id of the message carrying one review.
 *
 * DETERMINISTIC, and that is the whole trick. Saving feedback is an upsert — a
 * mentor may revise a review — and posting a fresh message each time would hand the
 * trainee two cards for one week and re-open the "which one is the real feedback"
 * question this design exists to close. A derived id means a revision EDITS the card
 * already in the thread, in place, with no column to store a message id in and so no
 * migration 104 for something this small.
 */
export function academyFeedbackMessageId(
  athleteId: string,
  workoutDate: string,
  activityId: string | null,
): string {
  const tail = activityId ? `-${activityId}` : '';
  return `acadfb-${athleteId}-${workoutDate}${tail}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Put the weekly review into the trainee's thread.
 *
 * NEVER throws. The review is already committed to Postgres by the time this runs,
 * and that row is the source of truth — the thread is delivery. A Stream outage must
 * not turn a saved review into a failed one for the mentor who just wrote it, so the
 * caller gets a boolean and decides what to say.
 */
export async function postAcademyFeedback(
  stream: StreamChat,
  supabase: SupabaseClient,
  {
    athleteId,
    authorStreamId,
    workoutDate,
    activityId,
    workoutName,
    feedback,
  }: {
    athleteId: string;
    authorStreamId: string;
    workoutDate: string;
    activityId: string | null;
    workoutName: string | null;
    feedback: TraineeFeedback;
  },
): Promise<{ posted: boolean; updated: boolean; error?: string }> {
  const attachment: AcademyFeedbackAttachment = {
    type: 'academy_feedback',
    version: ACADEMY_FEEDBACK_VERSION,
    workout_date: workoutDate,
    activity_id: activityId,
    workout_name: workoutName,
    feedback,
  };

  try {
    const { channel } = await ensureAcademyThread(stream, supabase, athleteId, authorStreamId);
    const id = academyFeedbackMessageId(athleteId, workoutDate, activityId);

    // The STRUCTURED feedback travels, not the rendered Hebrew, so the thread and the
    // activity page render one identical FeedbackCard from one payload.
    const payload = {
      id,
      // Empty text on purpose: the card IS the message. A text fallback would be a
      // second version of the review, which is the thing being avoided.
      text: '',
      user_id: authorStreamId,
      academy_feedback: attachment,
    } as Record<string, unknown>;

    try {
      await channel.sendMessage(payload as Record<string, unknown>);
      return { posted: true, updated: false };
    } catch {
      // Duplicate id — the mentor is revising. Edit the card that is already there.
      // Same shape and the same cast the plan-seed message uses in
      // `lib/run-chat/seed-chat.ts`: a custom top-level field is legal on the wire but
      // absent from Stream's generated message type.
      await stream.updateMessage(
        payload as unknown as Parameters<typeof stream.updateMessage>[0],
        authorStreamId,
      );
      return { posted: true, updated: true };
    }
  } catch (err: unknown) {
    console.error('postAcademyFeedback failed (review is saved; thread delivery is not):', err);
    return { posted: false, updated: false, error: String(err) };
  }
}

/**
 * The id of the message carrying one test summary.
 *
 * Derived from the test for the same reason `academyFeedbackMessageId` is derived from the day:
 * a coach who fixes a sentence and sends again must EDIT what the trainee already has. Posting a
 * second message would leave two summaries of one test in the thread and make the trainee decide
 * which of them is current — a question only the coach can answer.
 */
export function academyTestSummaryMessageId(testId: string): string {
  return `acadtest-${testId}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Send the approved test summary to the trainee.
 *
 * ── PLAIN TEXT, AND NOT A CARD ────────────────────────────────────────────────────────────
 *
 * The opposite choice from `postAcademyFeedback`, on purpose. The weekly review is a structure —
 * tags and lap comments — that two screens must render identically, so it travels structured. A
 * test summary is PROSE the coach wrote himself; the words are the artefact. Carrying it as an
 * attachment with empty text would also make it invisible: `toThreadMessages` drops messages with
 * neither text nor a known card, so an unrecognised attachment type reads to the trainee as
 * nothing at all. The thresholds are not in here either — they reach the trainee as the paces in
 * their plan, which is where a number they are meant to run is useful.
 *
 * NEVER throws, same contract as the review: the analysis is already committed and signed, and
 * the caller decides what to tell the coach about delivery.
 */
export async function postAcademyTestSummary(
  stream: StreamChat,
  supabase: SupabaseClient,
  {
    athleteId,
    authorStreamId,
    testId,
    summary,
  }: {
    athleteId: string;
    authorStreamId: string;
    testId: string;
    summary: string;
  },
): Promise<{ posted: boolean; updated: boolean; error?: string }> {
  const text = summary.trim();
  // An empty summary is not a message. Refused here as well as at the route, because "sent" with
  // nothing in it is the one delivery state that would be worse than not sending.
  if (!text) return { posted: false, updated: false, error: 'empty summary' };

  try {
    const { channel } = await ensureAcademyThread(stream, supabase, athleteId, authorStreamId);
    const payload = {
      id: academyTestSummaryMessageId(testId),
      text,
      user_id: authorStreamId,
    } as Record<string, unknown>;

    try {
      await channel.sendMessage(payload);
      return { posted: true, updated: false };
    } catch {
      // Duplicate id — the coach is resending a corrected summary.
      await stream.updateMessage(
        payload as unknown as Parameters<typeof stream.updateMessage>[0],
        authorStreamId,
      );
      return { posted: true, updated: true };
    }
  } catch (err: unknown) {
    console.error('postAcademyTestSummary failed (analysis is saved; delivery is not):', err);
    return { posted: false, updated: false, error: String(err) };
  }
}
