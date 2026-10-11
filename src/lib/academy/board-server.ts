/**
 * The footer marks of the week board's rows (trainee-experience-v2 screen 2): how the
 * trainee said it felt (🙂 חזק), how many comments are about the session (💬 2), and a
 * personal record it set (🏅). Server-only; every read here costs a mark, never the board.
 *
 *   feel      `workout_feedback` (the trainee's own questionnaire), keyed by the run's
 *             Garmin id — the key that table has always used.
 *   comments  the coach's review of the day (`academy_workout_feedback`, migration 103) plus
 *             the thread's messages tagged with that day (screen 6's `workout_date`). The
 *             thread is ONE Stream channel query per week; when Stream fails, the count is
 *             the review alone, so a Stream outage costs a number and not the board.
 *   pr        lib/academy/records.ts (through `personalRecord`), the rule the workout
 *             screen's medal and the coach's readiness line use, so the row, the screen it
 *             opens and C1 cannot disagree — a 1 km rep counts. Its season of runs (with
 *             laps) is read once per week, and only when a run of this week is a kilometre
 *             or more.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CHANNEL_TYPE, getStreamServerClient } from '@/lib/stream/server';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { RECORD_DAYS, RECORD_MIN_M } from './records';
import { readAll } from './load-server';
import { academyChannelId, replyDates, type StreamMessageLike } from './thread';
import { personalRecord } from './workout-extras';
import { shiftDate } from './load';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** The thread's history read for the counts — the transcript's own window. */
export const THREAD_WINDOW = 100;
/** The PR window and floor, as /api/academy/workout reads them (records.ts: 1 km and up), read whole. */
const PR_DAYS = RECORD_DAYS;

/**
 * The keys a run's "איך הרגשת?" can be stored under: its garmin_activity_id, and — for a
 * Strava run later upgraded in place to its Garmin twin — the `-strava_activity_id` it was
 * answered under before the upgrade (U12), so the answer is not orphaned.
 */
export function feedbackKeysOf(act: { garmin_activity_id?: unknown; strava_activity_id?: unknown }): number[] {
  const out: number[] = [];
  if (act.garmin_activity_id != null && Number.isFinite(Number(act.garmin_activity_id))) out.push(Number(act.garmin_activity_id));
  const s = Number(act.strava_activity_id);
  if (act.strava_activity_id != null && Number.isFinite(s) && s > 0 && !out.includes(-s)) out.push(-s);
  return out;
}

export interface RowMarks {
  /** 0–4 (חלש מאוד … חזק מאוד), the trainee's own answer. */
  feel?: number;
  /** The coach's review + the messages about the day. Absent at 0. */
  comments?: number;
  /** The record bucket key (`1k`, `5k`, `10k`, `hm`, `fm`) of a record set on this run. */
  pr?: string;
}

export interface BoardMarks {
  /** Per activity id: feel, pr, and the trainee's own note on the run. */
  byActivity: Map<string, { feel?: number; pr?: string; comment?: string }>;
  /** Per date: the comment count. */
  commentsByDate: Map<string, number>;
  /** Stream answered (false: the counts are the coach's reviews only). */
  threadRead: boolean;
}

/**
 * Count the thread's messages about each day of the week — tagged, or a coach's reply to a
 * tagged one (replyDates) — the coach's review cards excluded (they are counted from
 * Postgres, which is their source of truth).
 */
export function talkCounts(messages: StreamMessageLike[], weekStart: string, weekEnd: string, athleteId: string): Map<string, number> {
  const out = new Map<string, number>();
  // Oldest first, so a coach's untagged reply counts for the workout it answers (replyDates).
  const sorted = messages
    .map(m => {
      const t = m.created_at ? new Date(m.created_at).getTime() : NaN;
      return { m, at: Number.isNaN(t) ? '' : new Date(t).toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const dates = replyDates(sorted.map(({ m, at }) => ({
    at,
    fromTrainee: (m.user?.id ?? m.user_id ?? null) === athleteId,
    workoutDate: typeof m.workout_date === 'string' ? m.workout_date : null,
    review: !!m.academy_feedback,
  })));
  for (const [i, { m }] of sorted.entries()) {
    const date = dates[i];
    if (!date || date < weekStart || date > weekEnd) continue;
    if (m.academy_feedback || !(m.text ?? '').trim()) continue;
    out.set(date, (out.get(date) ?? 0) + 1);
  }
  return out;
}

async function readThread(athleteId: string): Promise<StreamMessageLike[] | null> {
  try {
    const stream = getStreamServerClient();
    const [channel] = await stream.queryChannels(
      { type: CHANNEL_TYPE, id: academyChannelId(athleteId) },
      [{ last_message_at: -1 }],
      { limit: 1, message_limit: THREAD_WINDOW, state: true, watch: false, presence: false },
    );
    return (channel?.state.messages ?? []) as unknown as StreamMessageLike[];
  } catch (err) {
    console.error('week-board: thread unavailable, counting reviews only:', err);
    return null;
  }
}

const toRun = (a: any) => ({ ...a, id: String(a.id), distance: Number(a.distance) || 0, duration: Number(a.duration) || 0 });

export async function loadBoardMarks(
  supabase: Db,
  input: { athleteId: string; weekStart: string; weekEnd: string; activityIds: string[] },
): Promise<BoardMarks> {
  const { athleteId, weekStart, weekEnd } = input;
  const ids = [...new Set(input.activityIds.filter(Boolean))];
  const byActivity: BoardMarks['byActivity'] = new Map();

  const [actsRes, reviewsRes, thread] = await Promise.all([
    ids.length
      ? supabase
        .from('athlete_activities')
        .select('id, garmin_activity_id, strava_activity_id, start_time, activity_type, distance, duration, laps')
        .eq('athlete_id', athleteId)
        .in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('academy_workout_feedback')
      .select('workout_date')
      .eq('athlete_id', athleteId)
      .gte('workout_date', weekStart)
      .lte('workout_date', weekEnd),
    readThread(athleteId),
  ]);

  // ── 💬 ──
  const commentsByDate = thread ? talkCounts(thread, weekStart, weekEnd, athleteId) : new Map<string, number>();
  // A missing table (migration 103 is hand-applied) reads as "no reviews", never an error.
  for (const r of (reviewsRes.error ? [] : reviewsRes.data || []) as Array<{ workout_date: string }>) {
    const date = String(r.workout_date).slice(0, 10);
    commentsByDate.set(date, (commentsByDate.get(date) ?? 0) + 1);
  }

  const acts = (actsRes.error ? [] : actsRes.data || []).map(toRun);
  if (!acts.length) return { byActivity, commentsByDate, threadRead: !!thread };

  // ── 🙂, and the trainee's note ──
  const garminIds = [...new Set(acts.flatMap(a => feedbackKeysOf(a)))];
  const runs = filterQualifyingRuns(acts).filter(a => a.distance >= RECORD_MIN_M);
  const [feelRes, seasonRes] = await Promise.all([
    garminIds.length
      ? supabase
        .from('workout_feedback')
        .select('garmin_activity_id, feel, comment')
        .eq('athlete_id', athleteId)
        .in('garmin_activity_id', garminIds)
      : Promise.resolve({ data: [], error: null }),
    // ── 🏅: only a run of a kilometre or more can hold a record (records.ts) ──
    runs.length
      ? readAll<any>((from, to) => supabase
        .from('athlete_activities')
        .select('id, start_time, activity_type, distance, duration, laps')
        .eq('athlete_id', athleteId)
        .gte('start_time', `${shiftDate(weekStart, -PR_DAYS)}T00:00:00Z`)
        .gte('distance', RECORD_MIN_M)
        .order('start_time', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), 200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const feelBy = new Map<number, { feel: number | null; comment: string | null }>();
  for (const f of (feelRes.error ? [] : feelRes.data || []) as Array<{ garmin_activity_id: number; feel: number | null; comment?: string | null }>) {
    feelBy.set(Number(f.garmin_activity_id), { feel: f.feel, comment: f.comment ?? null });
  }
  const season = (seasonRes.error ? [] : seasonRes.data || []).map(toRun);

  for (const a of acts) {
    // The run's own key first, then the pre-upgrade Strava key.
    const fb = feedbackKeysOf(a).map(k => feelBy.get(k)).find(Boolean);
    const marks: { feel?: number; pr?: string; comment?: string } = {};
    if (fb?.feel != null && Number.isFinite(Number(fb.feel))) marks.feel = Math.min(4, Math.max(0, Math.round(Number(fb.feel))));
    if (fb?.comment?.trim()) marks.comment = fb.comment.trim();
    if (season.length && runs.some(r => r.id === a.id)) {
      const pr = personalRecord(a, season);
      if (pr) marks.pr = pr.bucket;
    }
    byActivity.set(a.id, marks);
  }
  return { byActivity, commentsByDate, threadRead: !!thread };
}

/** The marks one row shows: only the true ones (no 💬 0). */
export function rowMarks(marks: BoardMarks, date: string, activityId: string | null): RowMarks {
  const out: RowMarks = {};
  const a = activityId ? marks.byActivity.get(activityId) : undefined;
  if (a?.feel != null) out.feel = a.feel;
  const n = marks.commentsByDate.get(date) ?? 0;
  if (n > 0) out.comments = n;
  if (a?.pr) out.pr = a.pr;
  return out;
}
