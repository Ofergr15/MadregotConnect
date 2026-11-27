import type { SupabaseClient } from '@supabase/supabase-js';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { academyManagerAthleteIds } from '@/lib/academy/thread-server';
import { isFixtureEmail } from '@/lib/notifications/feedback-recipients';
import { rolesForKind } from '@/lib/notifications/routing';
import { notifyAthlete } from '@/lib/push';
import { painReportCopy } from '@/lib/notifications/copy';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';
import { PAIN_AREA_HE, isSevere, resolvePainRecipients, staffMaySeePain, type PainArea } from './pain';
import { swallowAs } from '@/lib/errors/swallowed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const PAIN_SELECT =
  'id, athlete_id, area, side, severity, since, effect, note, activity_id, status, resolved_by, created_at, edited_at, withdrawn_at, resolved_at, seen_at, seen_by, last_followup_on, escalated_at';

export interface PainRow {
  id: string; athlete_id: string; area: string; side: string | null; severity: number; since: string;
  effect: string; note: string | null; activity_id: string | null; status: 'open' | 'resolved' | 'withdrawn';
  resolved_by: string | null; created_at: string; edited_at: string | null; withdrawn_at: string | null;
  resolved_at: string | null; seen_at: string | null; seen_by: string | null; last_followup_on: string | null;
  escalated_at: string | null;
}

/** Facts → ids. Every read is best-effort; a failed source costs only itself. */
export async function painRecipientIds(db: Db, runnerId: string): Promise<{ ids: string[]; isAcademy: boolean }> {
  const { data: runner } = await db.from('athletes').select('is_academy').eq('id', runnerId).maybeSingle();
  const isAcademy = !!runner?.is_academy;
  const [academyCoaches, managers, routedRoles] = await Promise.all([
    isAcademy ? coachIdsOf(db, runnerId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    isAcademy ? academyManagerAthleteIds(db) : Promise.resolve([] as string[]),
    rolesForKind('pain_report', db).catch(() => null),
  ]);
  let clubCoaches: string[] = [];
  if (!isAcademy) {
    const none = { data: [], error: null };
    const [p, e] = await Promise.all([
      Promise.resolve().then(() => db.from('athletes').select('id, email, status').eq('role', 'coach')).catch(() => none),
      Promise.resolve().then(() => db.from('athletes').select('id, email, status').contains('extra_roles', ['coach'])).catch(() => none),
    ]);
    const rows = [...(p.error ? [] : p.data || []), ...(e.error ? [] : e.data || [])] as Array<{ id: string; email: string | null; status?: string | null }>;
    clubCoaches = rows.filter((r) => !isFixtureEmail(r.email) && (r.status ?? 'active') === 'active').map((r) => r.id);
  }
  const candidates = [...new Set([...academyCoaches, ...managers, ...clubCoaches])];
  const rolesOf: Record<string, string[]> = {};
  if (candidates.length) {
    const { data } = await db.from('athletes').select('id, role, extra_roles').in('id', candidates);
    for (const r of (data || []) as Array<{ id: string; role: string | null; extra_roles?: string[] | null }>) {
      rolesOf[r.id] = [r.role || '', ...(r.extra_roles || [])].filter(Boolean);
    }
  }
  return {
    ids: resolvePainRecipients({ runnerId, isAcademy, academyCoaches, managers, clubCoaches, rolesOf, routedRoles }),
    isAcademy,
  };
}

/** Names for the privacy line ("רק נועה ואלדר יראו"), straight from the resolver. */
export async function painRecipientNames(db: Db, runnerId: string): Promise<string[]> {
  const { ids } = await painRecipientIds(db, runnerId);
  if (!ids.length) return [];
  const { data } = await db.from('athletes').select('id, name').in('id', ids);
  return ((data || []) as Array<{ name: string | null }>).map((r) => r.name || '').filter(Boolean);
}

/** Immediate, never digested. One notifyAthlete per recipient — never notifyStaff, which widens. */
export async function sendPainAlert(db: Db, row: Pick<PainRow, 'athlete_id' | 'area' | 'severity' | 'effect' | 'id'>): Promise<number> {
  try {
    const [{ ids }, { data: athlete }] = await Promise.all([
      painRecipientIds(db, row.athlete_id),
      db.from('athletes').select('name, avatar_url').eq('id', row.athlete_id).maybeSingle(),
    ]);
    const area = PAIN_AREA_HE[row.area as PainArea] ?? row.area;
    await Promise.all(ids.map((id) => notifyAthlete({
      athleteId: id,
      kind: 'pain_report',
      url: `/coach/pain/${row.id}`,
      tag: `pain-${row.id}`,
      category: 'management',
      actorAthleteId: row.athlete_id,
      icon: athlete?.avatar_url?.trim() || undefined,
      copy: (locale) => painReportCopy(locale, { athleteName: athlete?.name || 'רץ/ה', area, severity: row.severity, severe: isSevere(row) }),
    }).catch(swallowAs('feedback.pain.notify', null))));
    return ids.length;
  } catch {
    return 0;
  }
}

/** May this verified caller read / answer this runner's pain? Owner always; staff by scope. */
export async function callerMaySeePain(db: Db, caller: VerifiedCaller, runnerId: string): Promise<'owner' | 'staff' | null> {
  if (caller.athleteId && caller.athleteId === runnerId) return 'owner';
  if (!caller.isStaff && !caller.isSuperUser) return null;
  const { data: runner } = await db.from('athletes').select('is_academy').eq('id', runnerId).maybeSingle();
  const isAcademy = !!runner?.is_academy;
  const academyCoachIds = isAcademy ? await coachIdsOf(db, runnerId).catch(() => [] as string[]) : [];
  const roles = caller.roles ?? [caller.role];
  return staffMaySeePain({ athleteId: caller.athleteId, isSuperUser: caller.isSuperUser, roles }, { isAcademy, academyCoachIds })
    ? 'staff' : null;
}

/** Report + check-ins + thread, shaped for both sides. */
export async function painDetail(db: Db, row: PainRow, viewerId: string | null) {
  const [{ data: checkins }, { data: messages }] = await Promise.all([
    db.from('pain_checkins').select('id, trend, severity, created_at').eq('report_id', row.id).order('created_at'),
    db.from('pain_report_messages').select('id, sender_id, from_staff, body, created_at').eq('report_id', row.id).order('created_at'),
  ]);
  const senderIds = [...new Set(((messages || []) as Array<{ sender_id: string }>).map((m) => m.sender_id))];
  const names = new Map<string, string>();
  if (senderIds.length) {
    const { data } = await db.from('athletes').select('id, name').in('id', senderIds);
    for (const a of (data || []) as Array<{ id: string; name: string }>) names.set(a.id, a.name);
  }
  return {
    ...shapePain(row),
    checkins: ((checkins || []) as Array<{ id: string; trend: string; severity: number | null; created_at: string }>).map((c) => ({
      id: c.id, trend: c.trend, severity: c.severity, createdAt: c.created_at,
    })),
    messages: ((messages || []) as Array<{ id: string; sender_id: string; from_staff: boolean; body: string; created_at: string }>).map((m) => ({
      id: m.id, body: m.body, createdAt: m.created_at, fromStaff: m.from_staff,
      senderName: names.get(m.sender_id) ?? null, isMine: !!viewerId && m.sender_id === viewerId,
    })),
  };
}

export function shapePain(r: PainRow) {
  return {
    id: r.id, athleteId: r.athlete_id, area: r.area, areaLabel: PAIN_AREA_HE[r.area as PainArea] ?? r.area,
    side: r.side, severity: r.severity, since: r.since, effect: r.effect, note: r.note, activityId: r.activity_id,
    status: r.status, resolvedBy: r.resolved_by, createdAt: r.created_at, editedAt: r.edited_at,
    withdrawnAt: r.withdrawn_at, resolvedAt: r.resolved_at, seenAt: r.seen_at, severe: isSevere(r),
  };
}
