import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { feedbackAlertCopy } from '@/lib/notifications/copy';
import { notifyStaff } from '@/lib/notifications/staff';
import { feedbackRecipients } from '@/lib/notifications/feedback-recipients';
import { notifyAthlete } from '@/lib/push';
import { SUPER_USER_EMAIL } from '@/lib/constants';
import { inScope, staffAthleteScope } from '@/lib/academy/staff-scope';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import { requireCallerForAthlete, requireStaffCaller } from '@/lib/auth/self-or-staff';
import { parseFeedbackInput } from '@/lib/feedback-scales';

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
/** The super user's athlete row — the club's head coach (lib/constants SUPER_USER_EMAIL). */
async function headCoachIds(supabase: SupabaseServer): Promise<string[]> {
  const { data } = await supabase.from('athletes').select('id').eq('email', SUPER_USER_EMAIL).maybeSingle();
  return data?.id ? [String(data.id)] : [];
}

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
        `id, athlete_id, garmin_activity_id, difficulty, feel, pain, pain_detail, wants_feedback, comment, ${extra}created_at, athletes(name, avatar_url, group_id, groups!group_id(name))`;
      // The reports and the active roster in one wave — the roster is needed only
      // for the "who hasn't given feedback yet" list further down and has no
      // reason to wait for the reports. This route ran five round trips strictly
      // in series, and at ~350ms of Supabase latency each that was most of its
      // 1.6s regardless of how little data any one of them returned.
      const [feedbackRes, activeRes] = await Promise.all([
        supabase
          .from('workout_feedback')
          .select(baseCols(REPLY_COLS))
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(300)
          .then((res) => (res.error
            && ((res.error as { code?: string }).code === '42703' || /coach_reply/.test(res.error.message || ''))
            // Fall back if migration 036 isn't applied.
            ? supabase
              .from('workout_feedback')
              .select(baseCols(''))
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(300)
            : res)),
        supabase
          .from('athletes')
          .select('id, name, avatar_url, group_id, groups!group_id(name)')
          .eq('status', 'active'),
      ]);
      if (feedbackRes.error) throw feedbackRes.error;
      // An academy coach reads their own trainees' feedback, not the club's (launch BL9 / N8c).
      const scope = await staffAthleteScope(supabase, caller);
      const data = inScope(feedbackRes.data as any[] | null, scope, (r: any) => r.athlete_id);
      const activeAthletes = inScope(activeRes.data as any[] | null, scope, (a: any) => a.id);

      // Attach the activity each feedback is about (name/type/distance/time).
      const actIds = Array.from(
        new Set((data || []).map((r: any) => r.garmin_activity_id).filter(Boolean)),
      );
      const feedbackRows = (data || []) as unknown as Array<{ id: string; athlete_id: string }>;

      // Wave two: the activities the reports are about, every card's reply
      // thread, and the recent runs the "missing" list is derived from. All three
      // need only wave one, and none needs the others.
      const [actsRes, threads, recentRes] = await Promise.all([
        actIds.length > 0
          ? supabase
            .from('athlete_activities')
            .select('garmin_activity_id, activity_name, activity_type, distance, start_time')
            .in('garmin_activity_id', actIds)
          : Promise.resolve({ data: [] as any[] }),
        // Every card's reply thread, in two queries rather than one request per
        // card. `threadsForFeedback` explains what this replaces.
        threadsForFeedback(supabase, feedbackRows.map((r) => r.id), caller.athleteId),
        supabase
          .from('athlete_activities')
          .select('athlete_id, garmin_activity_id, activity_name, activity_type, distance, start_time')
          .in('athlete_id', (activeAthletes || []).map((a: any) => a.id))
          .gt('distance', 0)
          .gte('start_time', since)
          .order('start_time', { ascending: false }),
      ]);

      const actMap = new Map<number, any>();
      (actsRes.data || []).forEach((a: any) => actMap.set(a.garmin_activity_id, a));

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
      const recentActs = recentRes.data;
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

      // Not while an admin views the app as this coach (lib/auth/view-as.ts).
      if (!caller.viewingAsBy) await markThreadsRead(supabase, feedbackRows, caller.athleteId);

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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { athleteId, activityId, painDetail, comment } = body;
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }
    const parsed = parseFeedbackInput(body);
    if (!parsed.ok) return NextResponse.json({ error: `${parsed.field} out of range` }, { status: 400 });
    const { difficulty, feel, pain, wantsFeedback } = parsed.value;

    // The row is keyed on athlete_id, so without this anyone could file (or
    // overwrite, via the upsert) a pain report in someone else's name.
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const garminActivityId = activityId ? Number(activityId) : null;
    if (garminActivityId != null && !Number.isSafeInteger(garminActivityId)) {
      return NextResponse.json({ error: 'activityId invalid' }, { status: 400 });
    }

    // …and the run has to be theirs: otherwise a trainee files a feel (or a pain alert to
    // their own coach) about another trainee's activity, under their own name.
    if (garminActivityId != null) {
      const { data: owned, error: ownErr } = await supabase
        .from('athlete_activities')
        .select('id')
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', garminActivityId)
        .limit(1);
      if (ownErr) throw ownErr;
      if (!owned?.length) return NextResponse.json({ error: 'activity not found' }, { status: 404 });
    }

    // What was saved before, so a re-save of the same answer does not alert anyone twice:
    // each flag below fires only when it turns on.
    type Before = { pain?: boolean | null; difficulty?: number | null; wants_feedback?: boolean | null };
    let before: Before | null = null;
    if (garminActivityId != null) {
      const { data: prev } = await supabase
        .from('workout_feedback')
        .select('pain, difficulty, wants_feedback')
        .eq('athlete_id', athleteId)
        .eq('garmin_activity_id', garminActivityId)
        .maybeSingle();
      before = (prev as Before | null) ?? null;
    }

    const { error } = await supabase
      .from('workout_feedback')
      .upsert(
        {
          athlete_id: athleteId,
          garmin_activity_id: garminActivityId,
          difficulty,
          feel,
          pain,
          pain_detail: painDetail || null,
          wants_feedback: wantsFeedback ?? null,
          comment: comment || null,
        },
        { onConflict: 'athlete_id,garmin_activity_id' },
      );
    if (error) throw error;

    // Team alert (PRD §1): high difficulty (>=9), reported pain, or an explicit
    // request for feedback → push the coaches so they can reach out.
    const painNew = pain === true && before?.pain !== true;
    const hardNew = difficulty != null && difficulty >= 9 && !(Number(before?.difficulty) >= 9);
    const askNew = wantsFeedback === true && before?.wants_feedback !== true;
    const flag = painNew || hardNew || askNew;
    // Who a pain report reaches: the trainee's own coaches, or — a trainee with no coach —
    // the academy's managers. Said back to the screen, never a silent { success: true }.
    let painTo: 'coach' | 'managers' | null = null;
    if (flag) {
      // Same row already loaded for the alert's name — widen to avatar_url too
      // (no new join/table) so the coach's push shows the flagging athlete's
      // own photo, the same "who is this about" treatment as the coach-reply push.
      const { data: athlete } = await supabase
        .from('athletes')
        .select('name, avatar_url')
        .eq('id', athleteId)
        .maybeSingle();
      const name = athlete?.name || 'רץ/ה';
      const reason = pain ? 'דיווח/ה על כאב' : (difficulty != null && difficulty >= 9 ? 'קושי גבוה מאוד' : 'ביקש/ה משוב');
      // Was a hand-rolled fan-out over APPROVER_EMAILS that sent a push and
      // persisted NOTHING — so a coach whose phone was off never found out an
      // athlete had reported pain, and the club's own admin (synthetic Strava
      // address, on no email allowlist) was never told at all. notifyStaff
      // resolves by flag and role too, and writes the inbox row.
      await notifyStaff({
        kind: 'feedback_alert',
        // The workout-feedback triage list, not /dashboard/review (the bug-report form) —
        // launch N22.
        url: '/dashboard/workout-feedback',
        tag: `feedback-alert-${athleteId}`,
        category: 'management',
        actorAthleteId: athleteId,
        icon: athlete?.avatar_url?.trim() || undefined,
        copy: (locale) => feedbackAlertCopy(locale, { athleteName: name, reason }),
        // The club's head coach is a `runner` by role, so the role routing never reached
        // him: all 16 alerts of 09-07..10-19 went to the club account alone (Ofer, 10-19).
        extraRecipientIds: await headCoachIds(supabase),
      });
      // The runner's own coach hears it too — every flag, not only pain (2026-10-19):
      // the routed list above reached the operator account alone, so the club's coach
      // never saw a single alert or reply request. An academy trainee's coaches and the
      // managers; a club runner's club coaches (lib/notifications/feedback-recipients.ts).
      // Best-effort: a lookup that fails costs only this.
      try {
        const to = await feedbackRecipients(supabase, athleteId);
        if (painNew) painTo = to.to;
        await Promise.all(to.ids.map(coachId => notifyAthlete({
          athleteId: coachId,
          kind: 'feedback_alert',
          url: to.academy ? academyThreadUrl({ recipientIsStaff: true, traineeId: athleteId }) : '/dashboard/workout-feedback',
          tag: `feedback-alert-${athleteId}`,
          category: 'coach',
          actorAthleteId: athleteId,
          icon: athlete?.avatar_url?.trim() || undefined,
          copy: (locale) => feedbackAlertCopy(locale, { athleteName: name, reason }),
        }).catch(() => {})));
      } catch { /* best-effort */ }
    }

    return NextResponse.json({ success: true, ...(painTo ? { painTo, noCoach: painTo === 'managers' } : {}) });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
