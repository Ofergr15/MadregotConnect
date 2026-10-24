import { NextResponse } from 'next/server';
import { logWeek } from '@/lib/week-setup/server';
import { israelToday } from '@/lib/utils';
import { weekOfAction } from '@/lib/week-setup/log';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { publishGate } from '@/lib/access/publish-gate';
import { cancelSurveyReminders, createAndSendSurvey, dayBeforePushSoon, hasMigration164, MIGRATION_164, scheduleSurveyReminders } from '@/lib/surveys';
import { planReminders, readReminders } from '@/lib/survey-reminders';
import { closesAt } from '@/lib/publish/model';
import { MIGRATION_161, pinUntil, readPinChoice } from '@/lib/publish/pin';
import { hasMigration161, pinPost, publishClubPost } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// GET /api/admin/surveys — staff-only. Lists surveys newest-first with
// per-option response counts, for the Notification Center's results view.
// It lists who answered what, so it is the approvers' too (it had no gate at all).
export async function GET(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const { data: surveys, error } = await supabase
      .from('surveys')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const surveyIds = (surveys || []).map((s) => s.id);
    const { data: responses } = surveyIds.length
      ? await supabase.from('survey_responses').select('survey_id, option_index, athlete_id').in('survey_id', surveyIds)
      : { data: [] };

    const countsBySurvey = new Map<string, number[]>();
    // People, not rows: a survey with more than one answer has a row per answer (161).
    const people = new Map<string, Set<string>>();
    for (const r of responses || []) {
      const who = people.get(r.survey_id) ?? new Set<string>(); who.add(r.athlete_id); people.set(r.survey_id, who);
      const arr = countsBySurvey.get(r.survey_id) || [];
      arr[r.option_index] = (arr[r.option_index] || 0) + 1;
      countsBySurvey.set(r.survey_id, arr);
    }

    const withCounts = (surveys || []).map((s) => ({
      ...s,
      counts: s.options_he.map((_: string, i: number) => countsBySurvey.get(s.id)?.[i] || 0),
      totalResponses: people.get(s.id)?.size ?? 0,
    }));

    return NextResponse.json({ surveys: withCounts });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/admin/surveys — staff-only create + send immediately (surveys
// are always "now", unlike scheduled_notifications — a delayed survey isn't
// a case anyone asked for, and it'd add a second cron-scanning path for one
// notification kind). Creates the survey row, then a linked
// scheduled_notifications row (kind='survey') so it shows in the same
// Notification Center list as every other notification, then pushes.
export async function POST(request: Request) {
  try {
    const g = await publishGate(request, 'surveys', '/api/admin/surveys', (u) => !!u.canApprove);
    if (g.denied) return g.denied;
    const actorEmail = g.user.email ?? '';

    const body = await request.json();
    const { question_he, question_en, options_he, options_en, audience_type, audience_id } = body;
    // From "לפרסם › סקר" (mockup publish, C3): when it closes, whether it pushes, and a card on the feed.
    // `closesAt` is the date and time picked (polls-proposal, 10-20); `closes` the older quick choice.
    const picked = typeof body.closesAt === 'string' && Number.isFinite(Date.parse(body.closesAt)) ? new Date(body.closesAt).toISOString() : null;
    if (picked && (Date.parse(picked) <= Date.now() + 5 * 60_000 || Date.parse(picked) > Date.now() + 120 * 86_400_000)) {
      return NextResponse.json({ error: 'closesAt must be in the next 120 days' }, { status: 400 });
    }
    const closes = picked ?? (body.closes === 'tomorrow' || body.closes === 'week' ? closesAt(body.closes) : null);
    if (!question_he?.trim()) {
      return NextResponse.json({ error: 'question_he is required' }, { status: 400 });
    }
    const cleanOptionsHe = (options_he || []).map((o: string) => o.trim()).filter(Boolean);
    if (cleanOptionsHe.length < 2) {
      return NextResponse.json({ error: 'At least 2 options are required' }, { status: 400 });
    }

    // More than one answer, and pinned to the top (both 161): refused before anything is made.
    const multi = body.multi === true;
    const pin = pinUntil(readPinChoice(body.pin), new Date(), { date: typeof body.pinDate === 'string' ? body.pinDate : null, closesAt: closes });
    if ((multi || pin) && !(await hasMigration161(createServerClient()))) {
      return NextResponse.json({ error: MIGRATION_161 }, { status: 409 });
    }
    // Names hidden (164). Shown is the default and needs nothing.
    const anonymous = body.anonymous === true;
    if (anonymous && !(await hasMigration164(createServerClient()))) {
      return NextResponse.json({ error: MIGRATION_164 }, { status: 409 });
    }
    const audienceType = audience_type === 'group' || audience_type === 'academy' ? audience_type : 'all';
    const push = body.push !== false;
    // One push a day: a club poll published shortly before "מגיעים מחר?" rides inside it.
    const joinAt = push && audienceType === 'all' ? await dayBeforePushSoon(createServerClient()).catch(() => null) : null;

    const { survey, sent } = await createAndSendSurvey({
      questionHe: question_he,
      questionEn: question_en,
      optionsHe: cleanOptionsHe,
      optionsEn: options_en,
      audienceType,
      audienceId: audienceType === 'group' ? audience_id : null,
      createdBy: actorEmail,
      closesAt: closes,
      push,
      multi,
      anonymous,
      joinAt,
    });
    // The reminders ticked on the publish screen, to whoever has not answered by then.
    const { picked: keys, custom } = readReminders(body.reminders);
    let reminders = 0;
    try {
      reminders = await scheduleSurveyReminders(createServerClient(), {
        id: survey.id, question_he: question_he.trim(), audience_type: audienceType, audience_id: audienceType === 'group' ? audience_id : null,
      }, planReminders(closes, keys, custom), actorEmail ?? null);
    } catch (e) {
      // The poll is out; a reminder that failed to be scheduled must not report it as failed.
      console.error('[admin/surveys] reminders not scheduled:', e);
      await cancelSurveyReminders(createServerClient(), survey.id).catch(() => {});
    }
    // The survey on the feed, to answer in place (FeedCard's SurveyCard reads payload.surveyId).
    let feedItemId: string | null = null;
    if (body.feed === true) {
      feedItemId = await publishClubPost(createServerClient(), { body: question_he.trim(), payload: { surveyId: survey.id } });
      if (pin && feedItemId) await pinPost(createServerClient(), feedItemId, pin);
    }

    // In the week's log — a Saturday's poll is for the coming week (lib/week-setup, 10-24).
    await logWeek(createServerClient(), weekOfAction(israelToday()), { athleteId: g.user.athleteId ?? null, name: g.user.name ?? '' }, 'polls', 'poll_created', String(question_he || '').slice(0, 60));
    return NextResponse.json({ survey, sent, feedItemId, reminders, joinedAt: joinAt });
  } catch (err: unknown) {
    console.error('Failed to create survey:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
