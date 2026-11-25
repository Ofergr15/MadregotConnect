import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { traineeIdsOfCoach } from './trainee-coaches';
import { MOMENT_KINDS, type MomentKind, draftFor, momentState, onTime, windowOf } from './week-moments';
import { isFeatureEnabled } from '@/lib/features/server';

type Db = ReturnType<typeof createServerClient>;

export interface MomentRow {
  id: string; week_start: string; kind: MomentKind; author_id: string; body: string;
  goals: Array<{ text: string }>; notes: Record<string, string>; scheduled_at: string | null; sent_at: string | null;
}

/** Israel's UTC offset on a date ("+02:00" / "+03:00"), from the platform's tz data. */
export function israelOffsetOn(date: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`));
  const m = /GMT([+-])(\d{1,2})/.exec(parts.find((p) => p.type === 'timeZoneName')?.value ?? '');
  return m ? `${m[1]}${m[2].padStart(2, '0')}:00` : '+02:00';
}

/** Missing table (migration 212 not pasted) → callers answer 503 with this code, never a silent empty. */
export class MomentsNotMigrated extends Error { code = 'migration_pending'; }
function missing(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(e.message || ''));
}

export async function readMoments(db: Db, authorIds: string[], weekStart: string): Promise<MomentRow[]> {
  if (!authorIds.length) return [];
  const { data, error } = await db.from('academy_week_moments')
    .select('id, week_start, kind, author_id, body, goals, notes, scheduled_at, sent_at')
    .eq('week_start', weekStart).in('author_id', authorIds);
  if (missing(error)) throw new MomentsNotMigrated('migration 212 not applied');
  if (error) throw error;
  return (data || []) as MomentRow[];
}

export async function receiptCounts(db: Db, momentIds: string[]): Promise<Map<string, { delivered: number; read: number }>> {
  const out = new Map<string, { delivered: number; read: number }>();
  if (!momentIds.length) return out;
  const { data } = await db.from('academy_week_moment_receipts').select('moment_id, read_at').in('moment_id', momentIds);
  for (const r of (data || []) as Array<{ moment_id: string; read_at: string | null }>) {
    const c = out.get(r.moment_id) || { delivered: 0, read: 0 };
    c.delivered++; if (r.read_at) c.read++;
    out.set(r.moment_id, c);
  }
  return out;
}

/** The coach's four moments for a week: state, counts, and a draft where nothing is written yet. */
export async function coachWeek(db: Db, coachId: string, weekStart: string, nowIso: string) {
  const offset = israelOffsetOn(weekStart);
  const trainees = await traineeIdsOfCoach(db, coachId);
  const rows = await readMoments(db, [coachId], weekStart);
  const counts = await receiptCounts(db, rows.filter((r) => r.sent_at).map((r) => r.id));
  const ctx = await draftContext(db, trainees, weekStart);
  return {
    weekStart,
    recipients: trainees.length,
    moments: MOMENT_KINDS.map((kind) => {
      const row = rows.find((r) => r.kind === kind) ?? null;
      const win = windowOf(weekStart, kind, offset);
      const c = row ? counts.get(row.id) : undefined;
      const draft = row ? null : draftFor(kind, kind === 'prep_tue' ? { session: ctx.tue } : kind === 'prep_fri' ? { session: ctx.fri } : ctx);
      return {
        kind, id: row?.id ?? null, sendAt: win.at, dueBy: win.by,
        state: momentState(row, win, nowIso, offset),
        body: row?.body ?? draft?.body ?? '', goals: row?.goals ?? draft?.goals ?? [], notes: row?.notes ?? {},
        drafted: !row, scheduledAt: row?.scheduled_at ?? null, sentAt: row?.sent_at ?? null,
        delivered: c?.delivered ?? 0, read: c?.read ?? 0,
      };
    }),
  };
}

/** What the drafts are pre-written from: the group's quality sessions on Tue/Fri, and the week's size. */
async function draftContext(db: Db, trainees: string[], weekStart: string) {
  const out: { tue: string | null; fri: string | null; plannedKm: number | null; sessions: number | null } = { tue: null, fri: null, plannedKm: null, sessions: null };
  try {
    const { data } = await db.from('weekly_plans').select('parsed_workouts').eq('week_start_date', weekStart).is('athlete_id', null).eq('status', 'published').maybeSingle();
    const ws = ((data as { parsed_workouts?: unknown } | null)?.parsed_workouts as Array<{ dayOfWeek?: number; name?: string; distanceKm?: number }> | undefined) || [];
    out.tue = ws.find((w) => w.dayOfWeek === 2)?.name ?? null;
    out.fri = ws.find((w) => w.dayOfWeek === 5)?.name ?? null;
    out.sessions = ws.length || null;
    const km = ws.reduce((x, w) => x + (Number(w.distanceKm) || 0), 0);
    out.plannedKm = km > 0 ? km : null;
  } catch { /* a draft without context is still a draft */ }
  void trainees;
  return out;
}

/** Send a moment now: stamp it, write a receipt per trainee, push each one. Called by the coach's press, or by
 *  the tick for a time the coach chose. Idempotent: an already-sent moment is not sent again. */
export async function sendMoment(db: Db, momentId: string, nowIso: string): Promise<{ sent: number; already?: boolean }> {
  const { data: m, error } = await db.from('academy_week_moments')
    .select('id, kind, author_id, body, notes, sent_at').eq('id', momentId).maybeSingle();
  if (missing(error)) throw new MomentsNotMigrated('migration 212 not applied');
  if (!m) return { sent: 0 };
  const row = m as { id: string; kind: MomentKind; author_id: string; body: string; notes: Record<string, string>; sent_at: string | null };
  if (row.sent_at) return { sent: 0, already: true };
  // Claim first (WHERE sent_at IS NULL): two presses or a press plus the tick send once.
  const { data: claimed } = await db.from('academy_week_moments')
    .update({ sent_at: nowIso, updated_at: nowIso }).eq('id', row.id).is('sent_at', null).select('id');
  if (!claimed || !claimed.length) return { sent: 0, already: true };
  const trainees = await traineeIdsOfCoach(db, row.author_id);
  if (trainees.length) {
    await db.from('academy_week_moment_receipts').upsert(trainees.map((a) => ({ moment_id: row.id, athlete_id: a, delivered_at: nowIso })), { onConflict: 'moment_id,athlete_id', ignoreDuplicates: true });
  }
  const { data: coach } = await db.from('athletes').select('name').eq('id', row.author_id).maybeSingle();
  const first = String((coach as { name?: string } | null)?.name || '').split(/\s+/)[0] || 'המאמן';
  const title = { plan: `${first}: התוכנית לשבוע`, prep_tue: `${first}: ההכנה למחר`, prep_fri: `${first}: ההכנה למחר`, summary: `${first}: סיכום השבוע` }[row.kind];
  await Promise.all(trainees.map((a) => notifyAthlete({
    athleteId: a, kind: 'academy_week_moment', actorAthleteId: row.author_id,
    title, body: (row.notes?.[a] ? `${row.notes[a]} · ` : '') + row.body.slice(0, 140),
    url: `/dashboard/academy?moment=${row.id}`, tag: `academy-moment-${row.kind}`,
  }).catch(() => null)));
  return { sent: trainees.length };
}

/** The tick: send what a coach SCHEDULED and whose time has come. Never sends anything unscheduled. */
export async function dispatchScheduledMoments(db: Db, nowIso: string): Promise<{ sent: number }> {
  try {
    const { data, error } = await db.from('academy_week_moments').select('id, author_id')
      .is('sent_at', null).not('scheduled_at', 'is', null).lte('scheduled_at', nowIso).limit(50);
    if (error) return { sent: 0 };
    let sent = 0;
    // Gated rollout: a moment scheduled while the author had the flag stays unsent if it was turned off since.
    const allowed = new Map<string, boolean>();
    for (const r of (data || []) as Array<{ id: string; author_id: string }>) {
      if (!allowed.has(r.author_id)) allowed.set(r.author_id, await isFeatureEnabled('academy_week_moments', r.author_id, db).catch(() => false));
      if (!allowed.get(r.author_id)) continue;
      sent += (await sendMoment(db, r.id, nowIso)).sent;
    }
    return { sent };
  } catch (e) {
    console.error('[week-moments] dispatch failed', e);
    return { sent: 0 };
  }
}

/** The trainee's moments this week (only what was SENT to them), with their own note. Marks nothing read. */
export async function traineeWeek(db: Db, athleteId: string, weekStart: string) {
  const { data: rec, error } = await db.from('academy_week_moment_receipts')
    .select('moment_id, read_at, academy_week_moments!inner(id, week_start, kind, author_id, body, goals, notes, sent_at)')
    .eq('athlete_id', athleteId).eq('academy_week_moments.week_start', weekStart);
  if (missing(error)) throw new MomentsNotMigrated('migration 212 not applied');
  const rows = (rec || []) as unknown as Array<{ moment_id: string; read_at: string | null; academy_week_moments: MomentRow }>;
  const authors = [...new Set(rows.map((r) => r.academy_week_moments.author_id))];
  const { data: names } = authors.length ? await db.from('athletes').select('id, name').in('id', authors) : { data: [] };
  const nameOf = new Map(((names || []) as Array<{ id: string; name: string }>).map((n) => [n.id, n.name]));
  return rows.map((r) => {
    const m = r.academy_week_moments;
    return { id: m.id, kind: m.kind, sentAt: m.sent_at, body: m.body, goals: m.goals ?? [], note: m.notes?.[athleteId] ?? null,
      coachName: nameOf.get(m.author_id) ?? null, readAt: r.read_at };
  }).sort((a, b) => MOMENT_KINDS.indexOf(a.kind) - MOMENT_KINDS.indexOf(b.kind));
}

/** Manager: on time per coach × kind. Names of coaches only; no message text, no trainee names. */
export async function managerBoard(db: Db, weekStart: string, nowIso: string) {
  const offset = israelOffsetOn(weekStart);
  // The academy's coaches with at least one trainee (the same seat list as hub?view=manager).
  const { data: seat } = await db.from('athletes').select('id').in('role', ['academy_coach', 'coach', 'admin']);
  const coachIds: string[] = [];
  for (const c of (seat || []) as Array<{ id: string }>) if ((await traineeIdsOfCoach(db, c.id)).length) coachIds.push(c.id);
  const rows = await readMoments(db, coachIds, weekStart);
  const counts = await receiptCounts(db, rows.filter((r) => r.sent_at).map((r) => r.id));
  const { data: names } = coachIds.length ? await db.from('athletes').select('id, name').in('id', coachIds) : { data: [] };
  const coaches = ((names || []) as Array<{ id: string; name: string }>).map((c) => ({
    id: c.id, name: c.name,
    cells: MOMENT_KINDS.map((kind) => {
      const row = rows.find((r) => r.author_id === c.id && r.kind === kind) ?? null;
      const win = windowOf(weekStart, kind, offset);
      const k = row ? counts.get(row.id) : undefined;
      return { kind, onTime: onTime(row, win, nowIso), state: momentState(row, win, nowIso, offset), delivered: k?.delivered ?? 0, read: k?.read ?? 0 };
    }),
  }));
  const decided = coaches.flatMap((c) => c.cells).filter((x) => x.onTime !== null);
  return { weekStart, coaches, onTime: decided.filter((x) => x.onTime).length, total: decided.length };
}
