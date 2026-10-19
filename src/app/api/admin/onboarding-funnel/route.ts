import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { deviceFromUa } from '@/lib/onboarding/events';
import { buildMember, summarise, type MemberInput, type TimelineEvent } from '@/lib/onboarding/funnel';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { TEST_ACCOUNT_IDS } from '@/lib/auth/test-accounts';
import { placeCandidate, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import {
  ACADEMY_LANE_STAGES, CLUB_STAGES, byUrgency, isTestJoiner, laneStages, placeAcademyCandidate, placeClubMember,
  type JourneyPerson, type SentItem,
} from '@/lib/onboarding/journey';

export const dynamic = 'force-dynamic';

// GET /api/admin/onboarding-funnel — every member who joined through the real
// process (not the 2026-09-06 club backfill), as a timeline + the funnel
// (lib/onboarding/funnel.ts). Super user / approvers only: names and journeys.
const COHORT_SINCE = '2026-09-07T00:00:00Z';

type Req = { id: string; email: string; full_name: string | null; status: string; source: string | null; created_at: string; approved_at: string | null; athlete_id: string | null; notify_email?: string | null; group_id?: string | null };

/** The mails a person joining receives (not the staff's copies of them). */
const MEMBER_TEMPLATES = ['registration_received', 'registration_approved', 'user_approved', 'join_reminder', 'entry_nudge', 'login_code', 'phone_link', 'academy_form_received', 'academy_invite', 'academy_approved', 'academy_accepted'];
/** The pushes a person joining receives. */
const MEMBER_PUSH_KINDS = ['approval', 'entry_nudge', 'academy_joined', 'academy_trainee_assigned'];

type Db = ReturnType<typeof createServerClient>;

/** Every row, a page at a time: one request is capped at 1,000 rows, so `.limit(5000)` silently dropped the newest. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<{ rows: T[]; error: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) return { rows, error: true };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < 1000) break;
  }
  return { rows, error: false };
}

/** The academy lane: the intake board's own placement, minus archived and test rows. */
async function academyLane(db: Db, sentFor: (ids: { athleteId?: string | null; candidateId?: string | null; emails: string[] }) => SentItem[], now: Date) {
  const { data: cands, error } = await db.from('academy_candidates')
    .select('id, name, email, goal, source, athlete_id, archived_at, archived_reason, created_at, invited_at, accepted_at');
  if (error) return { stages: laneStages(ACADEMY_LANE_STAGES, []), people: [] as JourneyPerson[] };
  const { data: evs } = await db.from('academy_candidate_events').select('candidate_id, stage, occurred_at');
  const events: CandidateEvent[] = ((evs ?? []) as Array<{ candidate_id: string; stage: string; occurred_at: string }>)
    .map((e) => ({ candidateId: e.candidate_id, stage: e.stage, occurredAt: e.occurred_at }));
  const people: JourneyPerson[] = [];
  for (const c of (cands ?? []) as Array<{ id: string; name: string; email: string | null; goal: string | null; source: string | null; athlete_id: string | null; archived_at: string | null; archived_reason: string | null; created_at: string; invited_at: string | null; accepted_at: string | null }>) {
    if (c.archived_at || c.created_at < COHORT_SINCE || isTestJoiner([c.email], c.athlete_id, TEST_ACCOUNT_IDS)) continue;
    const row: CandidateRow = {
      id: c.id, name: c.name, goal: c.goal, source: c.source, athleteId: c.athlete_id, archivedAt: c.archived_at,
      archivedReason: c.archived_reason, createdAt: c.created_at, invitedAt: c.invited_at, acceptedAt: c.accepted_at,
    };
    const placed = placeCandidate(row, events, now.toISOString());
    const dones: Record<string, string> = {};
    for (const e of events) if (e.candidateId === c.id && (!dones[e.stage] || e.occurredAt < dones[e.stage])) dones[e.stage] = e.occurredAt;
    people.push(placeAcademyCandidate(placed, c.created_at, dones, c.athlete_id,
      sentFor({ athleteId: c.athlete_id, candidateId: c.id, emails: c.email ? [c.email] : [] }), now));
  }
  people.sort(byUrgency);
  return { stages: laneStages(ACADEMY_LANE_STAGES, people), people };
}
type Ath = { id: string; name: string | null; email: string | null; status: string; group_id?: string | null; created_at: string; approved_at: string | null; first_seen_at: string | null; last_seen_at: string | null; garmin_authed_at: string | null; garmin_auth: string | null; strava_auth: string | null; onboarding_tour_seen_at: string | null; onboarding_completed_at: string | null; phone_app_opened_at?: string | null };

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser && !auth.user.canApprove) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const db = createServerClient();

  const now = new Date();
  const REQ_COLS = 'id, email, full_name, status, source, created_at, approved_at, athlete_id, group_id';
  let reqRes = await db.from('signup_requests').select(`${REQ_COLS}, notify_email`).neq('source', 'club-backfill').order('created_at');
  if (reqRes.error) reqRes = await db.from('signup_requests').select(REQ_COLS).neq('source', 'club-backfill').order('created_at') as typeof reqRes;
  const reqs = (reqRes.data ?? []) as Req[];
  const ev = await readAll<{ athlete_id: string | null; signup_request_id: string | null; step: string; device: string | null; created_at: string }>(
    (from, to) => db.from('onboarding_events').select('athlete_id, signup_request_id, step, device, created_at').gte('created_at', COHORT_SINCE).order('created_at').range(from, to),
  );
  const events = ev.rows;

  const COLS = 'id, name, email, status, group_id, created_at, approved_at, first_seen_at, last_seen_at, garmin_authed_at, garmin_auth, strava_auth, onboarding_tour_seen_at, onboarding_completed_at';
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

  // What the club already sent each of them: mails (by id, or by address — the older
  // ones carry no id) and the joining pushes.
  const mails = await readAll<{ template: string; recipients: unknown; status: string; athlete_id: string | null; signup_request_id: string | null; candidate_id: string | null; created_at: string }>(
    (from, to) => db.from('email_log').select('template, recipients, status, athlete_id, signup_request_id, candidate_id, created_at')
      .in('template', MEMBER_TEMPLATES).gte('created_at', COHORT_SINCE).order('created_at').range(from, to),
  );
  const { data: pushRows } = await db.from('scheduled_notifications').select('kind, audience_id, status, created_at')
    .eq('audience_type', 'athlete').in('kind', MEMBER_PUSH_KINDS).gte('created_at', COHORT_SINCE);
  const pushes = (pushRows ?? []) as Array<{ kind: string; audience_id: string | null; status: string; created_at: string }>;
  const sentFor = (who: { athleteId?: string | null; requestId?: string | null; candidateId?: string | null; emails: string[] }): SentItem[] => {
    const addrs = who.emails.map((e) => e.toLowerCase().trim()).filter((e) => e && !isSyntheticAuthEmail(e));
    const out: SentItem[] = mails.rows
      .filter((r) => (who.athleteId && r.athlete_id === who.athleteId)
        || (who.requestId && r.signup_request_id === who.requestId)
        || (who.candidateId && r.candidate_id === who.candidateId)
        || (addrs.length > 0 && addrs.some((a) => JSON.stringify(r.recipients ?? '').toLowerCase().includes(a))))
      .map((r) => ({ kind: 'email' as const, key: r.template, at: r.created_at, ok: r.status === 'sent' }));
    if (who.athleteId) {
      for (const p of pushes) if (p.audience_id === who.athleteId) out.push({ kind: 'push', key: p.kind, at: p.created_at, ok: p.status !== 'failed' });
    }
    return out;
  };

  const club: JourneyPerson[] = [];
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
    const member = buildMember(input, now);
    // Turned down, or a test account: not somebody on the way in, so on neither lane.
    if (req?.status !== 'rejected' && !isTestJoiner([ath?.email, req?.email], ath?.id, TEST_ACCOUNT_IDS)) {
      club.push(placeClubMember({
        member,
        requestId: req?.id ?? null,
        requestStatus: req?.status ?? null,
        strava: isSyntheticAuthEmail(ath?.email) || req?.source === 'strava-login',
        notifyEmail: req?.notify_email ?? null,
        groupId: ath?.group_id ?? req?.group_id ?? null,
        sent: sentFor({ athleteId: ath?.id, requestId: req?.id, emails: [ath?.email, req?.email, req?.notify_email].filter((x): x is string => !!x) }),
      }, now));
    }
    return member;
  }).sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));
  club.sort(byUrgency);

  return NextResponse.json({
    summary: summarise(members),
    members,
    journey: {
      club: { stages: laneStages(CLUB_STAGES, club), people: club },
      academy: await academyLane(db, sentFor, now),
    },
    eventsRecording: !ev.error,
    at: now.toISOString(),
  });
}
