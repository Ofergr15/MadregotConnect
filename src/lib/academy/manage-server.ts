import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { notifyAthlete } from '@/lib/push';
import {
  academyCoachAddedCopy, academyCoachAssignedCopy, academyJoinedCopy, academyTraineeRemovedCopy,
  academyTraineesAssignedCopy, type PushCopy,
} from '@/lib/notifications/copy';
import type { NotificationLocale } from '@/lib/notifications/locale';
import { israelToday } from '@/lib/utils';
import { holdsAcademyCoachRole } from './coaches';
import { applyAcademyMembership } from './membership-server';
import { setPairCoaches, writeCoachPair } from './pairing-server';
import { coachIdsByTrainee, coachesOf, joinHebrewList, traineeIdsOfCoach } from './trainee-coaches';
import {
  applicationDeletable, deriveLeft,
  type AcademyPeopleResponse, type AddableMember, type ApplicantRow, type BulkRequest, type DeleteRefusal,
  type HistoryRow, type PendingApplicant,
} from './manage';

export type { AcademyPeopleResponse, AddableMember, PendingApplicant } from './manage';

// The server half of the manager's people tab (lib/academy/manage.ts is the pure
// half). Every caller of this module has already passed requireAcademyManager.

type Db = ReturnType<typeof createServerClient>;

// ── GET: who left, who is waiting, who could be added ───────────────────────

const PEOPLE_COLS = 'id, name, avatar_url, role, extra_roles, status, approved, approved_at, is_academy, onboarding_status, academy_coach_id, academy_joined_on, garmin_auth, strava_auth, created_at, groups!group_id(name)';
const PEOPLE_COLS_MIN = 'id, name, role, status, approved, is_academy, onboarding_status, academy_coach_id, academy_joined_on, garmin_auth, strava_auth, created_at';

async function readPeopleRows(supabase: Db): Promise<any[]> {
  const full = await supabase.from('athletes').select(PEOPLE_COLS).eq('coach_id', COACH_ID);
  if (!full.error) return full.data || [];
  const min = await supabase.from('athletes').select(PEOPLE_COLS_MIN).eq('coach_id', COACH_ID);
  if (min.error) throw min.error;
  return min.data || [];
}

async function readHistory(supabase: Db): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('academy_coach_history')
    .select('athlete_id, coach_id, started_on, ended_on');
  if (error) return [];
  return (data || []) as HistoryRow[];
}

/** Live cards: not archived and not yet accepted. Before 126 there is no `accepted_at`. */
async function readLiveCards(supabase: Db): Promise<Array<{ id: string; name: string; athlete_id: string | null; created_at: string }>> {
  let res: any = await supabase
    .from('academy_candidates')
    .select('id, name, athlete_id, created_at, archived_at, accepted_at');
  if (res.error && isMissingColumn(res.error)) {
    res = await supabase.from('academy_candidates').select('id, name, athlete_id, created_at, archived_at');
  }
  if (res.error) return [];
  return ((res.data || []) as any[]).filter((c) => !c.archived_at && !c.accepted_at);
}

async function readFormEvents(supabase: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data, error } = await supabase
    .from('academy_candidate_events')
    .select('candidate_id, occurred_at')
    .eq('stage', 'form')
    .in('candidate_id', ids);
  if (error) return out;
  for (const e of (data || []) as Array<{ candidate_id: string; occurred_at: string }>) out.set(String(e.candidate_id), e.occurred_at);
  return out;
}

export async function loadAcademyPeople(): Promise<AcademyPeopleResponse> {
  const supabase = createServerClient();
  const [rows, history, cards] = await Promise.all([readPeopleRows(supabase), readHistory(supabase), readLiveCards(supabase)]);
  const names = new Map<string, string>(rows.map((r: any) => [r.id, r.name]));
  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
  // Everyone who coaches somebody — every coach of a shared trainee included.
  const coachMap = await coachIdsByTrainee(supabase, undefined, rows.filter((r: any) => r.is_academy));
  const coaching = new Set([...coachMap.values()].flat());

  const left = deriveLeft(rows, history, names, israelToday());

  // Waiting: the form's own accounts (in the academy, never approved), and the
  // club members whose card says they filled the form but nobody let in yet.
  const formAt = await readFormEvents(supabase, cards.map((c) => c.id));
  const cardByAthlete = new Map(cards.filter((c) => c.athlete_id).map((c) => [String(c.athlete_id), c]));
  const pending: PendingApplicant[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.is_academy || r.approved !== false || r.status === 'removed') continue;
    const card = cardByAthlete.get(r.id) ?? null;
    seen.add(r.id);
    pending.push({
      key: r.id,
      athleteId: r.id,
      candidateId: card?.id ?? null,
      name: r.name,
      appliedAt: (card && formAt.get(card.id)) || r.created_at || null,
      clubMember: false,
      deletable: applicationDeletable(r as ApplicantRow, { dataRows: 0, coachesSomeone: coaching.has(r.id) }).ok,
    });
  }
  for (const c of cards) {
    if (!formAt.has(c.id)) continue;
    const a = c.athlete_id ? byId.get(String(c.athlete_id)) : null;
    if (!a || seen.has(a.id) || a.is_academy || a.approved === false) continue;
    pending.push({
      key: a.id, athleteId: a.id, candidateId: c.id, name: a.name || c.name,
      appliedAt: formAt.get(c.id) || c.created_at, clubMember: true, deletable: false,
    });
  }
  pending.sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));

  const addable: AddableMember[] = rows
    .filter((r: any) => !r.is_academy && r.approved !== false && !['removed', 'invited', 'disconnected'].includes(r.status))
    .map((r: any) => ({
      athleteId: r.id,
      name: r.name,
      avatarUrl: r.avatar_url || null,
      createdAt: r.created_at || null,
      groupName: r.groups?.name ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { left, pending, addable };
}

// ── POST bulk ───────────────────────────────────────────────────────────────

export interface BulkResult {
  athleteId: string;
  ok: boolean;
  unchanged?: boolean;
  /** not_found | not_member | already_member | not_club_member | write_failed | no_schema */
  error?: string;
  coachId?: string | null;
  /** The trainee's coaches after the write ('coach' / 'addCoach' / 'removeCoach'). */
  coachIds?: string[];
}

/** May this account be handed a trainee? Only an academy coach (the role, primary or extra). */
function canBeCoach(row: { id: string; role?: string | null; extra_roles?: string[] | null }): boolean {
  return holdsAcademyCoachRole(row);
}

async function readCoach(supabase: Db, id: string): Promise<{ id: string; name: string; role: string | null; extra_roles: string[] | null } | null> {
  let res: any = await supabase.from('athletes').select('id, name, role, extra_roles').eq('id', id).eq('coach_id', COACH_ID).maybeSingle();
  if (res.error && isMissingColumn(res.error)) {
    res = await supabase.from('athletes').select('id, name, role').eq('id', id).eq('coach_id', COACH_ID).maybeSingle();
  }
  if (res.error || !res.data) return null;
  return { extra_roles: null, ...res.data };
}

/** The coach each athlete had last, from the history the removal left behind. */
async function previousCoaches(supabase: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await supabase
    .from('academy_coach_history')
    .select('athlete_id, coach_id, started_on')
    .in('athlete_id', ids);
  if (error) return out;
  const latest = new Map<string, { coach_id: string | null; started_on: string }>();
  for (const h of (data || []) as Array<{ athlete_id: string; coach_id: string | null; started_on: string }>) {
    const cur = latest.get(h.athlete_id);
    if (!cur || h.started_on > cur.started_on) latest.set(h.athlete_id, h);
  }
  for (const [id, h] of latest) if (h.coach_id) out.set(id, h.coach_id);
  return out;
}

export async function runBulk(req: BulkRequest, caller: VerifiedCaller): Promise<Response> {
  const supabase = createServerClient();

  const { data: rowData, error: rowError } = await supabase
    .from('athletes')
    .select('id, name, is_academy, approved, status, academy_coach_id, academy_band_id')
    .in('id', req.athleteIds)
    .eq('coach_id', COACH_ID);
  if (rowError) return NextResponse.json({ error: 'Failed to read the trainees' }, { status: 500 });
  const rows = new Map(((rowData || []) as any[]).map((r) => [r.id, r]));

  // The coach and band are validated once, up front: one bad id fails the whole
  // request rather than half of it.
  let coach: { id: string; name: string } | null = null;
  if (req.coachId && ['coach', 'add', 'restore', 'addCoach'].includes(req.action) && !req.coachIds) {
    const c = await readCoach(supabase, req.coachId);
    if (!c) return NextResponse.json({ error: 'No such coach in this club' }, { status: 404 });
    if (!canBeCoach(c)) return NextResponse.json({ error: `${c.name} is not an academy coach` }, { status: 400 });
    coach = { id: c.id, name: c.name };
  }
  // 'coach' with a whole set: every coach in it checked the same way.
  const setCoaches: Array<{ id: string; name: string }> = [];
  for (const cid of req.coachIds ?? []) {
    const c = await readCoach(supabase, cid);
    if (!c) return NextResponse.json({ error: 'No such coach in this club' }, { status: 404 });
    if (!canBeCoach(c)) return NextResponse.json({ error: `${c.name} is not an academy coach` }, { status: 400 });
    setCoaches.push({ id: c.id, name: c.name });
  }
  // The trainees' current sets, for 'addCoach' / 'removeCoach' and the notifications.
  const isSetAction = req.action === 'coach' || req.action === 'addCoach' || req.action === 'removeCoach';
  const currentSets = isSetAction
    ? await coachIdsByTrainee(supabase, req.athleteIds, ((rowData || []) as any[]).map((r) => ({ id: r.id, academy_coach_id: r.academy_coach_id })))
    : new Map<string, string[]>();
  // Names for every coach a push may mention: the targets and everyone they hold today.
  const coachNames = new Map<string, string>([...setCoaches, ...(coach ? [coach] : [])].map((c) => [c.id, c.name]));
  if (isSetAction) {
    const unknown = [...new Set([...currentSets.values()].flat())].filter((id) => !coachNames.has(id));
    if (unknown.length) {
      const { data } = await supabase.from('athletes').select('id, name').in('id', unknown);
      for (const r of (data || []) as Array<{ id: string; name: string }>) coachNames.set(r.id, r.name);
    }
  }
  const nameOf = (id: string) => coachNames.get(id) || '';
  if (req.bandId && ['band', 'add', 'restore'].includes(req.action)) {
    const { data: band, error } = await supabase.from('academy_bands').select('id, name, active').eq('id', req.bandId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Academy bands are not available yet' }, { status: 409 });
    if (!band || band.active === false) return NextResponse.json({ error: 'No such band' }, { status: 404 });
  }

  // "Bring back": the coach they had, when they still coach; otherwise unpaired.
  const restoreCoach = new Map<string, { id: string; name: string }>();
  if (req.action === 'restore' && !coach) {
    const prev = await previousCoaches(supabase, req.athleteIds);
    for (const [athleteId, coachId] of prev) {
      const c = await readCoach(supabase, coachId);
      if (c && canBeCoach(c)) restoreCoach.set(athleteId, { id: c.id, name: c.name });
    }
  }

  // The manager's name, for "X added you" — read once, only when someone is told.
  const by = req.notify && (req.action === 'add' || req.action === 'restore') ? await managerName(supabase, caller) : null;

  const results: BulkResult[] = [];
  /** coachId → { name, trainee names } for the one push per coach. */
  const toCoaches = new Map<string, { trainees: string[] }>();
  /** coachId → trainee names, for the coaches taken off someone. */
  const fromCoaches = new Map<string, { trainees: string[] }>();
  const toTrainees: Array<{ athleteId: string; kind: string; copy: (locale: NotificationLocale) => PushCopy }> = [];
  const pushTo = (m: Map<string, { trainees: string[] }>, coachId: string, name: string) =>
    (m.get(coachId) ?? m.set(coachId, { trainees: [] }).get(coachId)!).trainees.push(name);

  for (const id of req.athleteIds) {
    const row = rows.get(id);
    if (!row) { results.push({ athleteId: id, ok: false, error: 'not_found' }); continue; }

    if (req.action === 'coach' || req.action === 'band' || req.action === 'remove') {
      if (!row.is_academy) { results.push({ athleteId: id, ok: false, error: 'not_member' }); continue; }
    }

    if (isSetAction) {
      const before = coachesOf(currentSets, id);
      const target = req.action === 'coach'
        ? (req.coachIds ?? (req.coachId ? [req.coachId] : []))
        : req.action === 'addCoach'
          ? [...before, req.coachId!]
          : before.filter((c) => c !== req.coachId);
      const r = await setPairCoaches(id, target, 'מנהל האקדמיה');
      if (!r.ok) {
        results.push({ athleteId: id, ok: false, coachId: target[0] ?? null, error: r.reason === 'no_schema' ? 'no_schema' : 'write_failed' });
        continue;
      }
      results.push({
        athleteId: id, ok: true, coachId: r.after[0] ?? null, coachIds: r.after,
        ...(r.unchanged ? { unchanged: true } : {}),
      });
      if (r.unchanged) continue;
      for (const c of r.added) pushTo(toCoaches, c, row.name);
      for (const c of r.removed) pushTo(fromCoaches, c, row.name);
      if (r.added.length) {
        const all = joinHebrewList(r.after.map(nameOf).filter(Boolean));
        const added = joinHebrewList(r.added.map(nameOf).filter(Boolean));
        // Somebody joined the coaches they keep → "a coach was added"; otherwise
        // (a new set, or a first coach) → "your coach(es): …", as before.
        const kept = r.after.filter((c) => !r.added.includes(c));
        toTrainees.push(kept.length
          ? { athleteId: id, kind: 'academy_coach_added', copy: (locale) => academyCoachAddedCopy(locale, { coach: added, all }) }
          : { athleteId: id, kind: 'academy_coach_assigned', copy: (locale) => academyCoachAssignedCopy(locale, { coach: all }) });
      }
      continue;
    }

    if (req.action === 'band') {
      if ((row.academy_band_id || null) === req.bandId) { results.push({ athleteId: id, ok: true, unchanged: true }); continue; }
      const { error } = await supabase.from('athletes').update({ academy_band_id: req.bandId }).eq('id', id).eq('coach_id', COACH_ID);
      results.push({ athleteId: id, ok: !error, ...(error ? { error: 'write_failed' } : {}) });
      continue;
    }

    if (req.action === 'remove') {
      const { error } = await supabase.from('athletes').update({ is_academy: false }).eq('id', id).eq('coach_id', COACH_ID);
      if (error) { results.push({ athleteId: id, ok: false, error: 'write_failed' }); continue; }
      await applyAcademyMembership(supabase, id, false);
      results.push({ athleteId: id, ok: true });
      continue;
    }

    // add / restore: an approved club member who is not in the academy now.
    if (row.is_academy) { results.push({ athleteId: id, ok: false, error: 'already_member' }); continue; }
    if (row.approved === false || ['removed', 'invited'].includes(row.status)) {
      results.push({ athleteId: id, ok: false, error: 'not_club_member' });
      continue;
    }
    const update: Record<string, unknown> = { is_academy: true };
    if (req.bandId) update.academy_band_id = req.bandId;
    const { error } = await supabase.from('athletes').update(update).eq('id', id).eq('coach_id', COACH_ID);
    if (error) { results.push({ athleteId: id, ok: false, error: 'write_failed' }); continue; }
    await applyAcademyMembership(supabase, id, true);
    const pairWith = coach ?? restoreCoach.get(id) ?? null;
    if (pairWith) {
      await writeCoachPair(id, pairWith.id, req.action === 'restore' ? 'חזר לאקדמיה' : 'נוסף לאקדמיה');
      pushTo(toCoaches, pairWith.id, row.name);
    }
    const pairName = pairWith?.name ?? null;
    toTrainees.push({
      athleteId: id,
      kind: 'academy_joined',
      copy: (locale) => (pairName ? academyCoachAssignedCopy(locale, { coach: pairName }) : academyJoinedCopy(locale, { by })),
    });
    results.push({ athleteId: id, ok: true, coachId: pairWith?.id ?? null });
  }

  if (req.notify) {
    // Best effort, after every write: a push that failed must never read as a
    // move that failed.
    const sends: Promise<unknown>[] = [];
    for (const t of toTrainees) {
      sends.push(notifyAthlete({
        athleteId: t.athleteId,
        kind: t.kind,
        actorAthleteId: caller.athleteId,
        copy: t.copy,
        url: '/dashboard/academy',
        tag: 'academy-coach',
      }));
    }
    for (const [coachId, { trainees }] of fromCoaches) {
      if (coachId === caller.athleteId) continue;
      sends.push(notifyAthlete({
        athleteId: coachId,
        kind: 'academy_trainee_removed',
        actorAthleteId: caller.athleteId,
        copy: (locale) => academyTraineeRemovedCopy(locale, { names: trainees }),
        url: '/dashboard/academy?tab=members',
        tag: 'academy-trainees',
      }));
    }
    for (const [coachId, { trainees }] of toCoaches) {
      if (coachId === caller.athleteId) continue;
      sends.push(notifyAthlete({
        athleteId: coachId,
        kind: 'academy_trainee_assigned',
        actorAthleteId: caller.athleteId,
        copy: (locale) => academyTraineesAssignedCopy(locale, { names: trainees }),
        url: '/dashboard/academy?tab=members',
        tag: 'academy-trainees',
      }));
    }
    await Promise.allSettled(sends).then((all) => {
      for (const r of all) if (r.status === 'rejected') console.error('Academy bulk: push failed:', r.reason);
    });
  }

  return NextResponse.json({
    action: req.action,
    results,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
}

async function managerName(supabase: Db, caller: VerifiedCaller): Promise<string | null> {
  if (!caller.athleteId) return null;
  const { data } = await supabase.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
  return (data as { name?: string } | null)?.name || null;
}

// ── DELETE an application ───────────────────────────────────────────────────

/**
 * The tables where a real person's club life lives. Every one of them (and every
 * other table that references `athletes`) is ON DELETE CASCADE or SET NULL, so
 * deleting the wrong row would silently take this with it. A single row in any
 * of them refuses the delete. A table that is not there yet counts as empty; any
 * other read error counts as "has data" — unsure means no.
 */
export const APPLICANT_DATA_TABLES = [
  'athlete_activities', 'weekly_plans', 'workout_attendance', 'workout_feedback', 'feed_items',
  'event_registrations', 'store_orders', 'push_subscriptions', 'athlete_badges', 'shoes',
  'academy_tests', 'academy_workout_feedback', 'academy_test_invitations', 'academy_test_analyses',
  'academy_payments', 'academy_billing', 'academy_coach_history',
] as const;

async function countApplicantData(supabase: Db, athleteId: string): Promise<number> {
  let total = 0;
  for (const table of APPLICANT_DATA_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('athlete_id', { count: 'exact', head: true })
      .eq('athlete_id', athleteId);
    if (error) {
      if (isMissingTable(error)) continue;
      return Number.POSITIVE_INFINITY;
    }
    total += count || 0;
  }
  return total;
}

const REFUSAL_TEXT: Record<DeleteRefusal, string> = {
  approved: 'This is an approved club member — remove them from the academy instead',
  not_form_account: 'This account was not opened by the academy form',
  staff: 'This account holds a staff role',
  connected: 'A watch was connected to this account',
  has_data: 'This account already has club data',
  coaches_someone: 'This account coaches a trainee',
  paired: 'This account was already an academy trainee',
};

/**
 * Delete an application: the funnel card and the account the form opened for it.
 * Refused (409) unless `applicationDeletable` says the account is nothing but the
 * form's. A card with no account behind it is just the card.
 */
export async function deleteApplication(p: { athleteId: string | null; candidateId: string | null }): Promise<Response> {
  const supabase = createServerClient();

  let candidateId = p.candidateId;
  let athleteId = p.athleteId;
  if (candidateId) {
    const { data: card, error } = await supabase.from('academy_candidates').select('id, athlete_id').eq('id', candidateId).maybeSingle();
    if (error && !isMissingTable(error)) return NextResponse.json({ error: 'Failed to read the application' }, { status: 500 });
    if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const linked = card.athlete_id ? String(card.athlete_id) : null;
    if (athleteId && linked && linked !== athleteId) {
      return NextResponse.json({ error: 'That card belongs to someone else' }, { status: 409 });
    }
    athleteId = athleteId || linked;
  }

  if (athleteId) {
    let res: any = await supabase
      .from('athletes')
      .select('id, approved, approved_at, status, role, extra_roles, onboarding_status, garmin_auth, strava_auth, academy_coach_id, academy_joined_on')
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (res.error) {
      // Not knowing every gate is a refusal, never a guess.
      return NextResponse.json({ error: 'Cannot verify this account, so it was not deleted' }, { status: 409 });
    }
    const row = res.data as ApplicantRow | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const coached = await supabase.from('athletes').select('id', { count: 'exact', head: true }).eq('academy_coach_id', athleteId);
    if (coached.error) return NextResponse.json({ error: 'Cannot verify this account, so it was not deleted' }, { status: 409 });
    // A co-coach of a shared trainee is in the link table only (135), not the column.
    const coSharing = (await traineeIdsOfCoach(supabase, athleteId)).length;
    const dataRows = await countApplicantData(supabase, athleteId);
    const verdict = applicationDeletable(row, { dataRows, coachesSomeone: (coached.count || 0) > 0 || coSharing > 0 });
    if (!verdict.ok) {
      return NextResponse.json({ error: REFUSAL_TEXT[verdict.reason], code: verdict.reason }, { status: 409 });
    }

    if (!candidateId) {
      const { data: card } = await supabase.from('academy_candidates').select('id').eq('athlete_id', athleteId).maybeSingle();
      candidateId = (card as { id?: string } | null)?.id ?? null;
    }
  }

  // The card first (its events cascade with it), then the account: a card left
  // pointing at nothing is SET NULL anyway, but an account with no card is the
  // kind of orphan nobody finds again.
  if (candidateId) {
    const { error } = await supabase.from('academy_candidates').delete().eq('id', candidateId);
    if (error && !isMissingTable(error)) return NextResponse.json({ error: 'Failed to delete the application' }, { status: 500 });
  }
  if (athleteId) {
    const { error } = await supabase
      .from('athletes')
      .delete()
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .eq('approved', false)
      .eq('onboarding_status', 'academy_pending');
    if (error) return NextResponse.json({ error: 'Failed to delete the account' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, athleteId, candidateId });
}
