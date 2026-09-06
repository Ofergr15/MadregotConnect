import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized } from '@/lib/push';
import { feedbackAlertCopy } from '@/lib/notifications/copy';
import { APPROVER_EMAILS } from '@/lib/constants';
import { requireCallerForAthlete, requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

type SupabaseServer = ReturnType<typeof createServerClient>;

interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  senderName: string | null;
  senderAvatarUrl: string | null;
}

/**
 * The reply threads for a whole page of feedback rows, in two queries.
 *
 * `FeedbackThread` is embedded in every card on the coach's triage list, and it
 * used to fetch its own thread from /api/workout-feedback/[id]/messages — so a
 * 30-day list of 200 rows opened 200 requests, each re-verifying the session,
 * re-reading the feedback row and re-resolving the caller before it got to the
 * messages. Same bytes on the wire either way; the cost was entirely in the
 * per-row round trips.
 *
 * Shaped to match that endpoint's `messages` field exactly, so the component
 * renders a seeded thread and a fetched one identically.
 */
async function threadsForFeedback(
  supabase: SupabaseServer,
  feedbackIds: string[],
  viewerAthleteId: string | null,
): Promise<Map<string, ThreadMessage[]>> {
  const byFeedback = new Map<string, ThreadMessage[]>();
  if (feedbackIds.length === 0) return byFeedback;

  const { data: rows, error } = await supabase
    .from('workout_feedback_messages')
    .select('id, feedback_id, sender_athlete_id, body, created_at')
    .in('feedback_id', feedbackIds)
    .order('created_at', { ascending: true });
  // A database without migration 063 has no thread table — the per-row endpoint
  // treats that as "no messages" too, so the list stays usable either way.
  if (error || !rows?.length) return byFeedback;

  const messageRows = rows as Array<{
    id: string; feedback_id: string; sender_athlete_id: string; body: string; created_at: string;
  }>;

  const senderIds = Array.from(new Set(messageRows.map((r) => r.sender_athlete_id)));
  const { data: senderRows } = await supabase
    .from('athletes')
    .select('id, name, avatar_url')
    .in('id', senderIds);
  const senderById = new Map(
    ((senderRows || []) as Array<{ id: string; name: string; avatar_url: string | null }>)
      .map((s) => [s.id, s]),
  );

  for (const r of messageRows) {
    const sender = senderById.get(r.sender_athlete_id);
    const list = byFeedback.get(r.feedback_id);
    const message: ThreadMessage = {
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      // The viewer here is staff, so "mine" means a reply they sent — except on
      // their own feedback row, where they're the athlete side. Either way it's
      // the same comparison, and `athleteId` is null for a staff account with no
      // `athletes` row, which owns no messages at all.
      isMine: !!viewerAthleteId && r.sender_athlete_id === viewerAthleteId,
      senderName: sender?.name || null,
      senderAvatarUrl: sender?.avatar_url || null,
    };
    if (list) list.push(message);
    else byFeedback.set(r.feedback_id, [message]);
  }
  return byFeedback;
}

/**
 * Mark the threads the viewer just loaded as caught-up, the way the per-row
 * endpoint's GET did on the way out — one statement per side instead of one per
 * card. An athlete replying on their own row reads the athlete side of it, so
 * the caller's own rows are stamped separately.
 *
 * Nothing reads these columns yet (there's no unread badge), but they're the
 * record of who has seen what, so a faster list shouldn't stop keeping it.
 * Best-effort: a failed stamp must not hide feedback that loaded fine.
 */
async function markThreadsRead(
  supabase: SupabaseServer,
  rows: Array<{ id: string; athlete_id: string }>,
  viewerAthleteId: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const mine = viewerAthleteId
    ? rows.filter((r) => r.athlete_id === viewerAthleteId).map((r) => r.id)
    : [];
  const mineSet = new Set(mine);
  const asCoach = rows.filter((r) => !mineSet.has(r.id)).map((r) => r.id);
  try {
    await Promise.all([
      mine.length
        ? supabase.from('workout_feedback').update({ athlete_last_read_at: now }).in('id', mine)
        : null,
      asCoach.length
        ? supabase.from('workout_feedback').update({ coach_last_read_at: now }).in('id', asCoach)
        : null,
    ]);
  } catch { /* best-effort */ }
}

// GET /api/workout-feedback?athleteId=…&activityId=…
//   -> the watch Self-Evaluation for the activity (to pre-fill / adapt the form)
//      plus any feedback already submitted.
// GET /api/workout-feedback?list=1[&days=N]
//   -> admin view: recent workout feedback across ALL athletes, newest first,
//      joined to athlete (name/avatar/squad) and the activity it's about.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const activityId = searchParams.get('activityId');

    if (searchParams.get('list')) {
      // Club-wide triage list: every athlete's pain reports and comments.
      const { denied: deniedList, caller } = await requireStaffCaller(request);
      if (deniedList) return deniedList;

      const supabase = createServerClient();
      const days = Math.min(Math.max(Number(searchParams.get('days')) || 30, 1), 180);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      // Prefer the reply-aware select; fall back if migration 036 isn't applied.
      const REPLY_COLS = 'coach_reply, coach_reply_at, coach_reply_by, ';
      const baseCols = (extra: string) =>
        `id, athlete_id, garmin_activity_id, difficulty, feel, pain, pain_detail, wants_feedback, comment, ${extra}created_at, athletes(name, avatar_url, group_id, groups(name))`;
      let { data, error } = await supabase
        .from('workout_feedback')
        .select(baseCols(REPLY_COLS))
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error && ((error as { code?: string }).code === '42703' || /coach_reply/.test(error.message || ''))) {
        ({ data, error } = await supabase
          .from('workout_feedback')
          .select(baseCols(''))
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(300));
      }
      if (error) throw error;

      // Attach the activity each feedback is about (name/type/distance/time).
      const actIds = Array.from(
        new Set((data || []).map((r: any) => r.garmin_activity_id).filter(Boolean)),
      );
      const actMap = new Map<number, any>();
      if (actIds.length > 0) {
        const { data: acts } = await supabase
          .from('athlete_activities')
          .select('garmin_activity_id, activity_name, activity_type, distance, start_time')
          .in('garmin_activity_id', actIds);
        (acts || []).forEach((a: any) => actMap.set(a.garmin_activity_id, a));
      }

      // Every card's reply thread, in two queries rather than one request per
      // card. `threadsForFeedback` explains what this replaces.
      const feedbackRows = (data || []) as unknown as Array<{ id: string; athlete_id: string }>;
      const threads = await threadsForFeedback(
        supabase,
        feedbackRows.map((r) => r.id),
        caller.athleteId,
      );

      const items = (data || []).map((r: any) => {
        const act = r.garmin_activity_id ? actMap.get(r.garmin_activity_id) : null;
        return {
          id: r.id,
          messages: threads.get(r.id) || [],
          athleteId: r.athlete_id,
          name: r.athletes?.name || '',
          avatarUrl: r.athletes?.avatar_url || null,
          squad: r.athletes?.groups?.name || null,
          activityId: r.garmin_activity_id,
          activityName: act?.activity_name || null,
          activityType: act?.activity_type || null,
          distance: act?.distance ?? null,
          startTime: act?.start_time || null,
          difficulty: r.difficulty,
          feel: r.feel,
          pain: r.pain,
          painDetail: r.pain_detail,
          wantsFeedback: r.wants_feedback,
          comment: r.comment,
          coachReply: r.coach_reply ?? null,
          coachReplyAt: r.coach_reply_at ?? null,
          createdAt: r.created_at,
        };
      });

      // Missing: for each active athlete, is their MOST RECENT workout in this
      // window still without feedback? (Not every gap — an athlete who's
      // never used the feature would otherwise flood this with dozens of old
      // rows; the coach only needs to know who to nudge *right now*.)
      const feedbackKey = (athleteId: string, activityId: number | null) => `${athleteId}:${activityId}`;
      const coveredKeys = new Set(
        (data || []).map((r: any) => feedbackKey(r.athlete_id, r.garmin_activity_id)),
      );
      const { data: activeAthletes } = await supabase
        .from('athletes')
        .select('id, name, avatar_url, group_id, groups(name)')
        .eq('status', 'active');
      const { data: recentActs } = await supabase
        .from('athlete_activities')
        .select('athlete_id, garmin_activity_id, activity_name, activity_type, distance, start_time')
        .in('athlete_id', (activeAthletes || []).map((a: any) => a.id))
        .gt('distance', 0)
        .gte('start_time', since)
        .order('start_time', { ascending: false });
      const latestByAthlete = new Map<string, any>();
      for (const act of (recentActs || [])) {
        if (!latestByAthlete.has(act.athlete_id)) latestByAthlete.set(act.athlete_id, act);
      }
      const missing = (activeAthletes || [])
        .map((a: any) => {
          const act = latestByAthlete.get(a.id);
          if (!act || coveredKeys.has(feedbackKey(a.id, act.garmin_activity_id))) return null;
          return {
            athleteId: a.id,
            name: a.name,
            avatarUrl: a.avatar_url || null,
            squad: a.groups?.name || null,
            activityId: act.garmin_activity_id,
            activityName: act.activity_name || null,
            activityType: act.activity_type || null,
            distance: act.distance ?? null,
            startTime: act.start_time || null,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''));

      await markThreadsRead(supabase, feedbackRows, caller.athleteId);

      return NextResponse.json({
        items,
        missing,
        counts: {
          total: items.length,
          pain: items.filter((i) => i.pain === true).length,
          wantsFeedback: items.filter((i) => i.wantsFeedback === true).length,
          withComment: items.filter((i) => !!i.comment).length,
          missing: missing.length,
        },
      });
    }

    if (!athleteId || !activityId) {
      return NextResponse.json({ error: 'athleteId and activityId required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();

    const { data: activity } = await supabase
      .from('athlete_activities')
      // `id` (the internal uuid) so the form can ask /api/plan-execution for this
      // run's grade — everything the athlete sees here is keyed by the GARMIN id,
      // which that endpoint doesn't know.
      .select('id, activity_name, activity_type, distance, start_time, perceived_rpe, perceived_feel')
      .eq('athlete_id', athleteId)
      .eq('garmin_activity_id', Number(activityId))
      .maybeSingle();

    let existing: Record<string, unknown> | null = null;
    {
      const withReply = await supabase
        .from('workout_feedback')
        .select('id, difficulty, feel, pain, pain_detail, wants_feedback, comment, coach_reply, coach_reply_at, reply_seen_at')
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', Number(activityId))
        .maybeSingle();
      if (withReply.data) {
        existing = withReply.data as Record<string, unknown>;
      } else {
        // maybeSingle swallows column errors as null; retry without reply cols so
        // a pre-migration DB still returns the athlete's own feedback.
        const retry = await supabase
          .from('workout_feedback')
          .select('id, difficulty, feel, pain, pain_detail, wants_feedback, comment')
          .eq('athlete_id', athleteId)
          .eq('garmin_activity_id', Number(activityId))
          .maybeSingle();
        existing = (retry.data as Record<string, unknown>) || null;
      }
    }

    return NextResponse.json({
      activity: activity || null,
      // Watch Self-Evaluation → seed the form; adapt follow-ups off these.
      watchRpe: activity?.perceived_rpe ?? null,
      watchFeel: activity?.perceived_feel ?? null,
      existing: existing || null,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/workout-feedback  { athleteId, activityId, difficulty, feel, pain, painDetail, wantsFeedback }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { athleteId, activityId, difficulty, feel, pain, painDetail, wantsFeedback, comment } = body;
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    // The row is keyed on athlete_id, so without this anyone could file (or
    // overwrite, via the upsert) a pain report in someone else's name.
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();

    const { error } = await supabase
      .from('workout_feedback')
      .upsert(
        {
          athlete_id: athleteId,
          garmin_activity_id: activityId ? Number(activityId) : null,
          difficulty: difficulty ?? null,
          feel: feel ?? null,
          pain: pain ?? null,
          pain_detail: painDetail || null,
          wants_feedback: wantsFeedback ?? null,
          comment: comment || null,
        },
        { onConflict: 'athlete_id,garmin_activity_id' },
      );
    if (error) throw error;

    // Team alert (PRD §1): high difficulty (>=9), reported pain, or an explicit
    // request for feedback → push the coaches so they can reach out.
    const flag = (difficulty != null && difficulty >= 9) || pain === true || wantsFeedback === true;
    if (flag) {
      try {
        // Same row already loaded for the alert's name — widen to avatar_url too
        // (no new join/table) so the coach's push shows the flagging athlete's
        // own photo, the same "who is this about" treatment as the coach-reply push.
        const { data: athlete } = await supabase
          .from('athletes')
          .select('name, avatar_url')
          .eq('id', athleteId)
          .maybeSingle();
        const name = athlete?.name || 'רץ/ה';
        const athleteAvatarUrl = athlete?.avatar_url?.trim() || '';
        const reason = pain ? 'דיווח/ה על כאב' : (difficulty >= 9 ? 'קושי גבוה מאוד' : 'ביקש/ה משוב');
        // Coaches are the athletes whose email is on the approver allowlist.
        const { data: coaches } = await supabase
          .from('athletes')
          .select('id')
          .in('email', APPROVER_EMAILS);
        const coachIds = (coaches || []).map((c: { id: string }) => c.id);
        if (coachIds.length > 0) {
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('id, endpoint, p256dh, auth, athlete_id')
            .in('athlete_id', coachIds);
          if (subs && subs.length > 0) {
            await sendPushLocalized(subs as any, (locale) => ({
              ...feedbackAlertCopy(locale, { athleteName: name, reason }),
              url: '/dashboard/review',
              tag: `feedback-alert-${athleteId}`,
              badge: 1,
              ...(athleteAvatarUrl ? { icon: athleteAvatarUrl } : {}),
            }));
          }
        }
      } catch { /* never let the alert fail the submit */ }
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
