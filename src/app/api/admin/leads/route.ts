import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { readMaintenance } from '@/lib/maintenance';
import { isBlockedByMaintenance } from '@/lib/admin/entry-queue';
import {
  buildLeads, filterLeads, leadTimeline, redactLead,
  type AthleteFacts, type CandidateLeadInput, type EmailLogRow, type OnboardingEventRow,
  type SignupLeadInput, type TouchRow, type U21LeadInput,
} from '@/lib/admin/leads';
import type { CandidateEvent } from '@/lib/academy/funnel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/leads?stage=&track=&from=&to= — who is at which signup stage,
// across the club form, the academy intake and U21, one row per person
// (lib/admin/leads.ts), each with its timeline: the mails sent, the onboarding
// events and the staff's own touches.
//
// Staff only. Email and phone only for an approver (`caller.canApprove`, off the
// verified session) — everyone else on staff gets the stage and the timeline, not
// the means to contact a stranger. Recipients are never copied into the timeline.
// Never persisted on the device: see NEVER_PERSIST in lib/swr-persist.ts.
//
// Tolerant of unapplied migrations: a missing table reads as empty, a missing
// column (207 `channel`, 208 `decision_note`, 131 `full_name`/`phone`) falls back.
// ═════════════════════════════════════════════════════════════════════════════

type Db = ReturnType<typeof createServerClient>;
type Row = Record<string, unknown>;

/** Try each column list in turn; a missing table or column is "nothing", never a 500. */
async function selectFirst(db: Db, table: string, columnSets: string[]): Promise<Row[]> {
  for (const cols of columnSets) {
    const { data, error } = await db.from(table).select(cols);
    if (!error) return (data ?? []) as unknown as Row[];
  }
  return [];
}

/** One request caps at 1,000 rows and reports the truncation as success. */
async function selectAll(db: Db, table: string, cols: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order('created_at').range(from, from + 999);
    if (error) return out;
    const got = (data ?? []) as unknown as Row[];
    out.push(...got);
    if (got.length < 1000) break;
  }
  return out;
}

const s = (v: unknown) => (typeof v === 'string' && v ? v : null);

export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const query = {
      stage: searchParams.get('stage'),
      track: searchParams.get('track'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    };
    if (query.track && !['club', 'academy', 'u21'].includes(query.track)) {
      return NextResponse.json({ error: 'track must be club, academy or u21' }, { status: 400 });
    }

    const db = createServerClient();
    const REQ = 'id, email, status, source, created_at, athlete_id';
    const [maintenance, reqRows, athRows, subs, candRows, candEvRows, u21Rows, emailRows, eventRows, touchRows] = await Promise.all([
      readMaintenance(),
      selectFirst(db, 'signup_requests', [
        `${REQ}, full_name, phone, channel, decision_note, decided_by_id`,
        `${REQ}, full_name, phone, decision_note, decided_by_id`,
        `${REQ}, full_name, phone`,
        REQ,
      ]),
      selectFirst(db, 'athletes', [
        'id, name, email, phone, approved, last_seen_at, garmin_auth, strava_auth',
        'id, name, email, phone, garmin_auth, strava_auth',
      ]),
      selectFirst(db, 'push_subscriptions', ['athlete_id']),
      selectFirst(db, 'academy_candidates', [
        'id, name, email, phone, goal, source, athlete_id, archived_at, archived_reason, created_at, invited_at, accepted_at',
        'id, name, email, phone, goal, source, athlete_id, archived_at, archived_reason, created_at',
      ]),
      selectFirst(db, 'academy_candidate_events', ['candidate_id, stage, occurred_at']),
      selectFirst(db, 'u21_registrations', ['id, track, first_name, last_name, email, phone, status, red_flag, created_at']),
      selectAll(db, 'email_log', 'template, subject, status, recipients, athlete_id, signup_request_id, candidate_id, created_at'),
      selectAll(db, 'onboarding_events', 'athlete_id, signup_request_id, step, created_at'),
      selectFirst(db, 'lead_touches', ['lead_ref, kind, by_id, at, note']),
    ]);

    const pushed = new Set(subs.map((r) => r.athlete_id as string));
    const athletes: AthleteFacts[] = athRows.map((a) => ({
      id: a.id as string,
      email: s(a.email),
      name: s(a.name),
      phone: s(a.phone),
      // Same default as the entry queue: a missing column means the club predates the gate.
      approved: a.approved === undefined ? true : a.approved !== false,
      blocked: isBlockedByMaintenance({ id: a.id as string, email: s(a.email) }, maintenance),
      lastSeenAt: s(a.last_seen_at),
      hasWatch: !!a.garmin_auth || !!a.strava_auth,
      hasPush: pushed.has(a.id as string),
    }));
    const signups: SignupLeadInput[] = reqRows
      // The 2026-09-06 backfill put the existing club into this table; they are not leads.
      .filter((r) => r.source !== 'club-backfill')
      .map((r) => ({
        id: r.id as string, email: s(r.email), fullName: s(r.full_name), phone: s(r.phone),
        status: String(r.status ?? 'pending'), source: s(r.source), channel: s(r.channel),
        createdAt: String(r.created_at), athleteId: s(r.athlete_id),
        decisionNote: s(r.decision_note), decidedById: s(r.decided_by_id),
      }));
    const candidates: CandidateLeadInput[] = candRows.map((c) => ({
      id: c.id as string, name: String(c.name ?? '—'), email: s(c.email), phone: s(c.phone), goal: s(c.goal),
      source: s(c.source), athleteId: s(c.athlete_id), archivedAt: s(c.archived_at), archivedReason: s(c.archived_reason),
      createdAt: String(c.created_at), invitedAt: s(c.invited_at), acceptedAt: s(c.accepted_at),
    }));
    const candidateEvents: CandidateEvent[] = candEvRows.map((e) => ({
      candidateId: e.candidate_id as string, stage: String(e.stage), occurredAt: String(e.occurred_at),
    }));
    const u21: U21LeadInput[] = u21Rows.map((u) => ({
      id: u.id as string, track: String(u.track), firstName: String(u.first_name ?? ''), lastName: String(u.last_name ?? ''),
      email: String(u.email ?? ''), phone: String(u.phone ?? ''), status: String(u.status), redFlag: u.red_flag === true,
      createdAt: String(u.created_at),
    }));

    const now = new Date().toISOString();
    const leads = buildLeads({ signups, athletes, candidates, candidateEvents, u21, now });
    const rows = {
      emails: emailRows as unknown as EmailLogRow[],
      events: eventRows as unknown as OnboardingEventRow[],
      touches: touchRows as unknown as TouchRow[],
    };

    const out = filterLeads(leads, query).map((lead) => {
      const timeline = leadTimeline(lead, rows);
      const lastEmail = timeline.find((t) => t.kind === 'email')?.at ?? null;
      // The match keys are internal; the client gets the refs, not the id lists.
      const { signupIds: _s, candidateIds: _c, ...rest } = lead;
      return { ...redactLead({ ...rest, lastEmail }, caller.canApprove), timeline };
    });

    return NextResponse.json({ leads: out, canApprove: caller.canApprove, at: now });
  } catch (err) {
    console.error('Failed to build the leads list:', err);
    return NextResponse.json({ error: 'Failed to build the leads list' }, { status: 500 });
  }
}
