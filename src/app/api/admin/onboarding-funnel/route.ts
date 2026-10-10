import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { deviceFromUa } from '@/lib/onboarding/events';
import { buildMember, summarise, type MemberInput, type TimelineEvent } from '@/lib/onboarding/funnel';

export const dynamic = 'force-dynamic';

// GET /api/admin/onboarding-funnel — every member who joined through the real
// process (not the 2026-09-06 club backfill), as a timeline + the funnel
// (lib/onboarding/funnel.ts). Super user / approvers only: names and journeys.
const COHORT_SINCE = '2026-09-07T00:00:00Z';

type Req = { id: string; email: string; full_name: string | null; status: string; source: string | null; created_at: string; approved_at: string | null; athlete_id: string | null };
type Ath = { id: string; name: string | null; email: string | null; status: string; created_at: string; approved_at: string | null; first_seen_at: string | null; last_seen_at: string | null; garmin_authed_at: string | null; garmin_auth: string | null; strava_auth: string | null; onboarding_tour_seen_at: string | null; onboarding_completed_at: string | null; phone_app_opened_at?: string | null };

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser && !auth.user.canApprove) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const db = createServerClient();

  const { data: reqData } = await db.from('signup_requests').select('id, email, full_name, status, source, created_at, approved_at, athlete_id').neq('source', 'club-backfill').order('created_at');
  const reqs = (reqData ?? []) as Req[];
  const ev = await db.from('onboarding_events').select('athlete_id, signup_request_id, step, device, created_at').order('created_at').limit(5000);
  const events = ev.error ? [] : (ev.data ?? []) as Array<{ athlete_id: string | null; signup_request_id: string | null; step: string; device: string | null; created_at: string }>;

  const COLS = 'id, name, email, status, created_at, approved_at, first_seen_at, last_seen_at, garmin_authed_at, garmin_auth, strava_auth, onboarding_tour_seen_at, onboarding_completed_at';
  let athRes = await db.from('athletes').select(`${COLS}, phone_app_opened_at`);
  if (athRes.error) athRes = await db.from('athletes').select(COLS) as typeof athRes;
  const athletes = (athRes.data ?? []) as Ath[];
  const byEmail = new Map(athletes.map((a) => [(a.email || '').toLowerCase(), a]));
  const byId = new Map(athletes.map((a) => [a.id, a]));

  // The cohort: every non-backfill request (resolved to its athlete), every athlete
  // created since the process existed, and anyone the new events know about.
  const cohort = new Map<string, { req: Req | null; ath: Ath | null }>();
  for (const r of reqs) {
    const a = (r.athlete_id && byId.get(r.athlete_id)) || byEmail.get(r.email.toLowerCase()) || null;
    // An existing member signing in through Strava also leaves a request row; they did not join now.
    if (a && a.created_at < COHORT_SINCE) continue;
    const key = a?.id ?? `req:${r.id}`;
    if (!cohort.has(key)) cohort.set(key, { req: r, ath: a });
  }
  for (const a of athletes) if (a.created_at >= COHORT_SINCE && !cohort.has(a.id)) cohort.set(a.id, { req: null, ath: a });
  for (const e of events) if (e.athlete_id && !cohort.has(e.athlete_id) && byId.get(e.athlete_id)) cohort.set(e.athlete_id, { req: null, ath: byId.get(e.athlete_id)! });

  const ids = [...cohort.values()].map((c) => c.ath?.id).filter((x): x is string => !!x);
  const { data: pushData } = ids.length ? await db.from('push_subscriptions').select('athlete_id, created_at, user_agent').in('athlete_id', ids).order('created_at') : { data: [] };
  const pushBy = new Map<string, Array<{ at: string; device: string | null }>>();
  for (const p of (pushData ?? []) as Array<{ athlete_id: string; created_at: string; user_agent: string | null }>) {
    pushBy.set(p.athlete_id, [...(pushBy.get(p.athlete_id) ?? []), { at: p.created_at, device: deviceFromUa(p.user_agent) }]);
  }

  const members = [...cohort.values()].map(({ req, ath }) => {
    const evs: TimelineEvent[] = events
      .filter((e) => (ath && e.athlete_id === ath.id) || (req && e.signup_request_id === req.id))
      .map((e) => ({ step: e.step, at: e.created_at, device: e.device, source: 'event' as const }));
    const input: MemberInput = {
      athleteId: ath?.id ?? null,
      name: ath?.name || req?.full_name || (req?.email ?? '').split('@')[0],
      source: req?.source ?? (ath ? 'direct' : null),
      requestedAt: req?.created_at ?? ath?.created_at ?? null,
      requestStatus: req?.status ?? null,
      approvedAt: req?.approved_at ?? ath?.approved_at ?? null,
      firstSeenAt: ath?.first_seen_at ?? null,
      lastSeenAt: ath?.last_seen_at ?? null,
      garminAt: ath?.garmin_authed_at ?? null,
      hasGarmin: !!ath?.garmin_auth,
      hasStrava: !!ath?.strava_auth,
      tourSeenAt: ath?.onboarding_tour_seen_at ?? null,
      setupDoneAt: ath?.onboarding_completed_at ?? null,
      phoneOpenedAt: ath?.phone_app_opened_at ?? null,
      push: ath ? pushBy.get(ath.id) ?? [] : [],
      events: evs,
    };
    return buildMember(input);
  }).sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));

  return NextResponse.json({ summary: summarise(members), members, eventsRecording: !ev.error, at: new Date().toISOString() });
}
