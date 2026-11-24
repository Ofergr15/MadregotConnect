// ═════════════════════════════════════════════════════════════════════════════
// THE LEADS SCREEN — one row per person on the way in, across the three doors.
//
// A person can arrive through the club's form (`signup_requests`), the academy's
// intake (`academy_candidates`) and the U21 form (`u21_registrations`), and the same
// person often uses two of them. The screen's promise is ONE row per person, so this
// merges by real email address, falling back to the athlete row, and keeps every
// source's ref so the timeline and the touch log see all of them.
//
// The stage is NOT re-derived here. It is what the existing screens already say:
//  - club    → `entryStage()` (lib/admin/entry-queue.ts), the entry queue's own stage,
//              or 'pending'/'rejected' for a request with no athlete row yet;
//  - academy → `placeCandidate()` (lib/academy/funnel.ts): the stage they wait for,
//              or 'joined'/'archived';
//  - u21     → the row's own review status.
//
// A server function, not a SQL view: the stage lives in tested TypeScript, and a view
// would have to copy it into SQL — the drift CLAUDE.md warns about for group colours.
// Pure: the route does the reads (src/__tests__/adminLeads.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

import { entryStage, realEmail } from '@/lib/admin/entry-queue';
import { placeCandidate, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';

export type LeadTrack = 'club' | 'academy' | 'u21';
export type LeadSource = 'signup' | 'academy' | 'u21';

/** When one person came through several doors, the most specific one names the row. */
const TRACK_PRIORITY: LeadTrack[] = ['academy', 'u21', 'club'];

export interface SignupLeadInput {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  /** Migration 207 (PR #94). Null until it lands. */
  channel: string | null;
  createdAt: string;
  athleteId: string | null;
  decisionNote: string | null;
  decidedById: string | null;
}

export interface AthleteFacts {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  approved: boolean;
  blocked: boolean;
  lastSeenAt: string | null;
  hasWatch: boolean;
  hasPush: boolean;
}

export interface CandidateLeadInput extends CandidateRow {
  email: string | null;
  phone: string | null;
}

export interface U21LeadInput {
  id: string;
  track: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  redFlag: boolean;
  createdAt: string;
}

export interface Lead {
  /** The primary source's ref: what POST /api/admin/leads/touch takes. */
  ref: string;
  /** Every source this person came through, as `<source>:<id>`. */
  refs: string[];
  track: LeadTrack;
  tracks: LeadTrack[];
  channel: string | null;
  stage: string;
  name: string;
  /** Stripped by the route unless the caller may approve. */
  email: string | null;
  phone: string | null;
  athleteId: string | null;
  /** The earliest arrival through any door. */
  since: string;
  /** ISO of the newest email_log row for this person; filled by `attachLastEmail`. */
  lastEmail: string | null;
  decisionNote: string | null;
  redFlag: boolean;
  /** Ids per source, for the timeline match. */
  signupIds: string[];
  candidateIds: string[];
}

export const leadRef = (source: LeadSource, id: string) => `${source}:${id}`;

const LEAD_REF_RE = /^(signup|academy|u21):[0-9a-f-]{36}$/i;
export function isLeadRef(ref: unknown): ref is string {
  return typeof ref === 'string' && LEAD_REF_RE.test(ref);
}

/** The entry queue's stage for a club request — the same call the queue makes. */
export function clubStage(req: Pick<SignupLeadInput, 'status'>, athlete: AthleteFacts | null): string {
  if (req.status === 'rejected') return 'rejected';
  if (!athlete) return 'pending';
  return entryStage(athlete);
}

/** The intake board's stage for a candidate — what they are waiting for. */
export function academyStage(c: CandidateRow, events: CandidateEvent[], nowISO: string): { stage: string; since: string } {
  const placed = placeCandidate(c, events, nowISO);
  if (placed.status !== 'live') return { stage: placed.status, since: placed.waitingSince };
  return { stage: placed.waitingFor ?? 'joined', since: placed.waitingSince };
}

const norm = (e: string | null | undefined) => realEmail(e)?.toLowerCase().trim() || null;

interface Part {
  source: LeadSource;
  id: string;
  track: LeadTrack;
  stage: string;
  channel: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  athleteId: string | null;
  since: string;
  decisionNote: string | null;
  redFlag: boolean;
}

export function buildLeads(input: {
  signups: SignupLeadInput[];
  athletes: AthleteFacts[];
  candidates: CandidateLeadInput[];
  candidateEvents: CandidateEvent[];
  u21: U21LeadInput[];
  now: string;
}): Lead[] {
  const athById = new Map(input.athletes.map((a) => [a.id, a]));
  const athByEmail = new Map<string, AthleteFacts>();
  for (const a of input.athletes) { const k = norm(a.email); if (k) athByEmail.set(k, a); }

  const parts: Part[] = [];
  for (const r of input.signups) {
    const ath = (r.athleteId && athById.get(r.athleteId)) || (norm(r.email) && athByEmail.get(norm(r.email)!)) || null;
    parts.push({
      source: 'signup', id: r.id, track: 'club', stage: clubStage(r, ath), channel: r.channel ?? r.source ?? null,
      name: r.fullName?.trim() || ath?.name || realEmail(r.email)?.split('@')[0] || '—',
      email: norm(r.email) ?? norm(ath?.email), phone: r.phone || ath?.phone || null,
      athleteId: ath?.id ?? r.athleteId ?? null, since: r.createdAt, decisionNote: r.decisionNote, redFlag: false,
    });
  }
  for (const c of input.candidates) {
    const { stage } = academyStage(c, input.candidateEvents, input.now);
    const ath = c.athleteId ? athById.get(c.athleteId) ?? null : null;
    parts.push({
      source: 'academy', id: c.id, track: 'academy', stage, channel: c.source ?? null, name: c.name,
      email: norm(c.email) ?? norm(ath?.email), phone: c.phone || ath?.phone || null,
      athleteId: c.athleteId ?? null, since: c.createdAt, decisionNote: null, redFlag: false,
    });
  }
  for (const u of input.u21) {
    const ath = norm(u.email) ? athByEmail.get(norm(u.email)!) ?? null : null;
    parts.push({
      source: 'u21', id: u.id, track: 'u21', stage: u.status, channel: u.track, name: `${u.firstName} ${u.lastName}`.trim(),
      email: norm(u.email), phone: u.phone || null, athleteId: ath?.id ?? null, since: u.createdAt,
      decisionNote: null, redFlag: u.redFlag,
    });
  }

  // Union-find over the two identities a part can carry: its email and its athlete.
  const groups = new Map<string, Part[]>();
  const keyOf = new Map<string, string>();
  for (const p of parts) {
    const ids = [p.email && `e:${p.email}`, p.athleteId && `a:${p.athleteId}`].filter((x): x is string => !!x);
    const hits = [...new Set(ids.map((i) => keyOf.get(i)).filter((x): x is string => !!x))];
    const key = hits[0] ?? `${p.source}:${p.id}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(p);
    for (const other of hits.slice(1)) {
      for (const q of groups.get(other) ?? []) bucket.push(q);
      groups.delete(other);
      for (const [k, v] of keyOf) if (v === other) keyOf.set(k, key);
    }
    groups.set(key, bucket);
    for (const i of ids) keyOf.set(i, key);
  }

  const leads: Lead[] = [];
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) =>
      TRACK_PRIORITY.indexOf(a.track) - TRACK_PRIORITY.indexOf(b.track) || b.since.localeCompare(a.since));
    const head = sorted[0];
    const pick = <K extends keyof Part>(k: K) => sorted.map((p) => p[k]).find((v) => v !== null && v !== '') ?? null;
    leads.push({
      ref: leadRef(head.source, head.id),
      refs: sorted.map((p) => leadRef(p.source, p.id)),
      track: head.track,
      tracks: [...new Set(sorted.map((p) => p.track))],
      channel: head.channel ?? (pick('channel') as string | null),
      stage: head.stage,
      name: head.name,
      email: pick('email') as string | null,
      phone: pick('phone') as string | null,
      athleteId: pick('athleteId') as string | null,
      since: sorted.map((p) => p.since).sort()[0],
      lastEmail: null,
      decisionNote: pick('decisionNote') as string | null,
      redFlag: sorted.some((p) => p.redFlag),
      signupIds: sorted.filter((p) => p.source === 'signup').map((p) => p.id),
      candidateIds: sorted.filter((p) => p.source === 'academy').map((p) => p.id),
    });
  }
  return leads.sort((a, b) => b.since.localeCompare(a.since));
}

export interface EmailLogRow {
  template: string;
  subject: string | null;
  status: string;
  recipients: unknown;
  athlete_id: string | null;
  signup_request_id: string | null;
  candidate_id?: string | null;
  created_at: string;
}

/** Does this mail belong to this lead — by back-reference, or by address for the older rows. */
export function emailBelongs(lead: Lead, r: EmailLogRow): boolean {
  if (lead.athleteId && r.athlete_id === lead.athleteId) return true;
  if (r.signup_request_id && lead.signupIds.includes(r.signup_request_id)) return true;
  if (r.candidate_id && lead.candidateIds.includes(r.candidate_id)) return true;
  if (!lead.email || !Array.isArray(r.recipients)) return false;
  return r.recipients.some((x) => String(x).toLowerCase().trim() === lead.email);
}

export interface TimelineItem {
  kind: 'email' | 'event' | 'touch';
  at: string;
  /** email: the template; event: the onboarding step; touch: call/message/note. */
  key: string;
  subject?: string | null;
  status?: string;
  note?: string | null;
  byId?: string | null;
}

export interface OnboardingEventRow { athlete_id: string | null; signup_request_id: string | null; step: string; created_at: string }
export interface TouchRow { lead_ref: string; kind: string; by_id: string | null; at: string; note: string | null }

/**
 * Everything that happened to one lead, newest first. Recipients are never copied
 * onto an item: the address is PII and only approvers get it, on the lead itself.
 */
export function leadTimeline(lead: Lead, rows: { emails: EmailLogRow[]; events: OnboardingEventRow[]; touches: TouchRow[] }): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const r of rows.emails) if (emailBelongs(lead, r)) out.push({ kind: 'email', at: r.created_at, key: r.template, subject: r.subject, status: r.status });
  for (const e of rows.events) {
    if ((lead.athleteId && e.athlete_id === lead.athleteId) || (e.signup_request_id && lead.signupIds.includes(e.signup_request_id))) {
      out.push({ kind: 'event', at: e.created_at, key: e.step });
    }
  }
  for (const t of rows.touches) if (lead.refs.includes(t.lead_ref)) out.push({ kind: 'touch', at: t.at, key: t.kind, note: t.note, byId: t.by_id });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function filterLeads(leads: Lead[], q: { stage?: string | null; track?: string | null; from?: string | null; to?: string | null }): Lead[] {
  return leads.filter((l) =>
    (!q.stage || l.stage === q.stage)
    && (!q.track || l.tracks.includes(q.track as LeadTrack))
    && (!q.from || l.since >= q.from)
    && (!q.to || l.since <= (q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to)));
}

/** Contact details off, for a staff member who may not approve. */
export function redactLead<T extends Pick<Lead, 'email' | 'phone'>>(lead: T, canApprove: boolean): T {
  return canApprove ? lead : { ...lead, email: null, phone: null };
}
