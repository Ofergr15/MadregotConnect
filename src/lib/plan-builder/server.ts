import { createServerClient } from '@/lib/supabase/server';
import { parseWorkoutPlan, EmptyParseError, ParseTimeoutError } from '@/lib/ai/parser';
import type { ParsedWeeklyPlan } from '@/lib/ai/types';
import { normalizeParsedWorkouts, normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { revalidateWeeklyPlans } from '@/lib/plans/cache';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { notifyAthlete } from '@/lib/push';
import { recipientsForKind } from '@/lib/notifications/routing';
import { COACH_ID } from '@/lib/constants';
import { resolveGroup, addDaysToDateStr } from '@/lib/utils';
import { annotatePlan, stripAnnotations } from './provenance';
import { affectedGroups, changeMessage, diffPlans, type GroupNo } from './diff';
import { lockView, mayTakeLock, type LockRow } from './lock';
import { classifyPushError, nextRetryAt } from './push-status';
import { CHANGE_NOTICE_SCOPE, COPY_LAST_WEEK_PACE_SHIFT_SEC, DEFAULT_OVERWRITE_WATCH } from './constants';
import { shiftPaces } from './schedule';

type Db = ReturnType<typeof createServerClient>;

export class MigrationPending extends Error { code = 'migration_pending'; }
function check<T>(r: { data: T; error: any }): T {
  if (r.error) {
    if (r.error.code === '42P01' || /does not exist|schema cache/i.test(r.error.message || '')) throw new MigrationPending('migration 187 not applied');
    throw new Error(r.error.message);
  }
  return r.data;
}

export interface VersionRow {
  id: string; week_start: string; plan_id: string | null; version: number; body: ParsedWeeklyPlan;
  state: 'draft' | 'scheduled' | 'published' | 'superseded' | 'unpublished';
  publish_at: string | null; publish_opts: PublishOpts | null; published_at: string | null;
  /** null / absent = the group week. Set = one academy trainee's own week (migration 198). */
  athlete_id?: string | null;
}
export interface PublishOpts { notify: boolean; push: boolean; overwriteWatch: boolean; message?: string | null; scope?: 'affected' | 'everyone' }

// ── Parse jobs ──────────────────────────────────────────────────────────────

export interface ParseInput { text?: string; imageBase64?: string; imageMediaType?: string }

export async function createParseJob(db: Db, weekStart: string, input: ParseInput, by: string | null) {
  const kind = input.imageBase64 ? (input.imageMediaType === 'application/pdf' ? 'pdf' : 'image') : 'text';
  return check(await db.from('plan_parse_jobs')
    .insert({ week_start: weekStart, input_kind: kind, created_by: by, status: 'queued', stage: 'upload' })
    .select('id').single()) as { id: string };
}

/** Runs after the reply (next/server `after`). The coach's phone only polls. */
export async function runParseJob(db: Db, id: string, input: ParseInput, notifyId: string | null) {
  const cancelled = async () => (check(await db.from('plan_parse_jobs').select('status').eq('id', id).single()) as any)?.status === 'cancelled';
  await db.from('plan_parse_jobs').update({ status: 'running', stage: 'reading', started_at: new Date().toISOString() }).eq('id', id);
  try {
    const plan = await parseWorkoutPlan(input);
    if (await cancelled()) return;
    await db.from('plan_parse_jobs').update({ stage: 'checking' }).eq('id', id);
    const result = annotatePlan(normalizeWorkoutParts(plan));
    await db.from('plan_parse_jobs').update({ status: 'done', stage: 'done', result, finished_at: new Date().toISOString() }).eq('id', id);
    if (notifyId) {
      await notifyAthlete({
        athleteId: notifyId, kind: 'plan_parse_done', category: 'management', url: `/coach/plan?job=${id}`,
        title: 'התוכנית נקראה', body: result.flagCount ? `${result.flagCount} פריטים לבדיקה` : 'מוכנה לבדיקה',
      }).catch(() => {});
    }
  } catch (err: any) {
    if (await cancelled().catch(() => false)) return;
    const code = err instanceof EmptyParseError ? 'empty_parse'
      : err instanceof ParseTimeoutError ? 'parse_timeout'
      : /credit balance/i.test(err?.message || '') ? 'insufficient_credits'
      : err?.status === 429 || err?.status === 529 ? 'rate_limited' : 'parse_failed';
    await db.from('plan_parse_jobs').update({ status: 'failed', error_code: code, error: String(err?.message || err).slice(0, 500), finished_at: new Date().toISOString() }).eq('id', id);
  }
}

export function jobView(row: any, now = Date.now()) {
  const start = Date.parse(row.started_at || row.created_at);
  const end = row.finished_at ? Date.parse(row.finished_at) : now;
  return {
    id: row.id, status: row.status, stage: row.stage, inputKind: row.input_kind,
    elapsedSec: Math.max(0, Math.round((end - start) / 1000)),
    result: row.status === 'done' ? row.result : null,
    error: row.status === 'failed' ? { code: row.error_code, message: row.error } : null,
  };
}

// ── Whose week ──────────────────────────────────────────────────────────────
//
// Every version / lock / weekly_plans query below is scoped by `who`: null = the group week,
// a uuid = that trainee's own week (migration 198). The two streams must never cross — an
// unscoped draft lookup, supersede or unpublish would mix a trainee's week into the club's.

export type Who = string | null;

/** `.is('athlete_id', null)` for the group, `.eq('athlete_id', X)` for a trainee. */
export function scopeTo<Q extends { is: (c: string, v: null) => Q; eq: (c: string, v: string) => Q }>(q: Q, who: Who): Q {
  return who ? q.eq('athlete_id', who) : q.is('athlete_id', null);
}

const missingAthleteCol = (e: any) => !!e && (e.code === '42703' || e.code === 'PGRST204') && /athlete_id/.test(e.message || '');

/**
 * Runs a versions/locks query scoped to `who`. The GROUP path keeps working before migration
 * 198 (the column is missing → the same query unscoped, which is exactly today's behaviour);
 * a TRAINEE path never falls back — it throws MigrationPending (→ 503), so nothing is ever
 * written to the group week on a trainee's behalf.
 */
async function scoped<T>(who: Who, make: (scope: boolean) => PromiseLike<{ data: any; error: any }>): Promise<T> {
  const r = await make(true);
  if (r.error && missingAthleteCol(r.error)) {
    if (who) throw new MigrationPending('migration 198 not applied');
    return check(await make(false)) as T;
  }
  return check(r) as T;
}

// ── Versions ────────────────────────────────────────────────────────────────

export async function versionsFor(db: Db, week: string, who: Who = null): Promise<VersionRow[]> {
  return (await scoped<VersionRow[]>(who, (sc) => {
    const q = db.from('weekly_plan_versions').select('*').eq('week_start', week);
    return (sc ? scopeTo(q as any, who) : q).order('version', { ascending: false });
  })) || [];
}
const live = (vs: VersionRow[]) => vs.find((v) => v.state === 'published') || null;
const draftOf = (vs: VersionRow[]) => vs.find((v) => v.state === 'draft' || v.state === 'scheduled') || null;
/** The week's draft or scheduled version, for this scope only. */
export async function draftFor(db: Db, week: string, who: Who = null) { return draftOf(await versionsFor(db, week, who)); }
export async function publishedFor(db: Db, week: string, who: Who = null) { return live(await versionsFor(db, week, who)); }

export async function readLock(db: Db, week: string, who: Who = null): Promise<LockRow | null> {
  return scoped<LockRow | null>(who, (sc) => {
    const q = db.from('plan_edit_locks').select('*').eq('week_start', week);
    return (sc ? scopeTo(q as any, who) : q).maybeSingle();
  });
}

/** The group week's live body, for a trainee week with no version of its own (`fromClub`). */
async function groupSeed(db: Db, week: string): Promise<ParsedWeeklyPlan | null> {
  const vs = await versionsFor(db, week, null);
  const v = live(vs) || draftOf(vs);
  if (v) return v.body;
  const { data } = await db.from('weekly_plans').select('parsed_workouts').eq('week_start_date', week).is('athlete_id', null).eq('status', 'published').maybeSingle();
  return legacyBody(data?.parsed_workouts);
}
function legacyBody(pw: any): ParsedWeeklyPlan | null {
  return pw?.workouts ? pw : pw?.group1 ? pw.group1 : null;
}

export async function weekState(db: Db, week: string, me: string, who: Who = null) {
  const [vs, lock] = await Promise.all([versionsFor(db, week, who), readLock(db, week, who)]);
  const published = live(vs);
  let draft = draftOf(vs);
  // A trainee week nobody has built yet: the club's week as the seed (matches week-board).
  // The seed is not a stored version (id null, version 0) — the first PUT stores it.
  let fromClub = false;
  if (who && !vs.length) {
    const seed = await groupSeed(db, week);
    if (seed) {
      fromClub = true;
      draft = { id: null as any, week_start: week, plan_id: null, version: 0, body: seed, state: 'draft', publish_at: null, publish_opts: null, published_at: null, athlete_id: who };
    }
  }
  const changes = published && draft ? diffPlans(published.body, draft.body) : [];
  const push = published ? await pushSummary(db, published.id) : null;
  const prev = addDaysToDateStr(week, -7);
  const lastWeek = (await versionsFor(db, prev, who)).some((v) => v.state === 'published')
    || (!!who && (await versionsFor(db, prev, null)).some((v) => v.state === 'published'));
  return {
    week, published, draft, audience: await audience(db, who),
    diff: { changes, groups: affectedGroups(changes), message: changeMessage(changes) },
    lock: lockView(lock, me), push, lastWeek,
    ...(who ? { athleteId: who, fromClub } : {}),
  };
}

export async function saveDraft(db: Db, week: string, body: ParsedWeeklyPlan, by: string, who: Who = null) {
  const vs = await versionsFor(db, week, who);
  const clean = stripAnnotations(body as any);
  const draft = draftOf(vs);
  if (draft) {
    return check(await db.from('weekly_plan_versions').update({ body: clean, state: 'draft', publish_at: null }).eq('id', draft.id).select('*').single()) as VersionRow;
  }
  return check(await db.from('weekly_plan_versions')
    .insert({ week_start: week, version: (vs[0]?.version ?? 0) + 1, body: clean, state: 'draft', created_by: by, plan_id: live(vs)?.plan_id ?? null, ...(who ? { athlete_id: who } : {}) })
    .select('*').single()) as VersionRow;
}

/**
 * Last week's published plan as this week's draft. A trainee: their own previous week
 * (builder version, else their legacy weekly_plans row), falling back to the GROUP's
 * previous week — today's copy-week semantics.
 */
export async function copyLastWeek(db: Db, week: string, by: string, who: Who = null) {
  const prevWeek = addDaysToDateStr(week, -7);
  let body = live(await versionsFor(db, prevWeek, who))?.body as ParsedWeeklyPlan | undefined;
  if (!body && who) {
    const { data } = await db.from('weekly_plans').select('parsed_workouts, created_at').eq('week_start_date', prevWeek).eq('athlete_id', who).order('created_at', { ascending: false }).limit(1);
    body = legacyBody((data as any[])?.[0]?.parsed_workouts) ?? undefined;
  }
  if (!body && who) body = live(await versionsFor(db, prevWeek, null))?.body;
  if (!body) {
    // Fallback to the legacy table: a week published before the builder existed.
    const { data } = await db.from('weekly_plans').select('parsed_workouts').eq('week_start_date', prevWeek).is('athlete_id', null).eq('status', 'published').maybeSingle();
    body = legacyBody(data?.parsed_workouts) ?? undefined;
  }
  if (!body) return null;
  return saveDraft(db, week, shiftPaces(body, COPY_LAST_WEEK_PACE_SHIFT_SEC), by, who);
}

/** Who a publish reaches: the sentence above the publish button. Counts only — never the credential. */
export async function audience(db: Db, who: Who = null) {
  let q = db.from('athletes').select('garmin_auth, is_academy');
  q = who ? q.eq('id', who) : q.eq('status', 'active');
  const { data } = await q;
  const rows = (data as any[]) || [];
  return { runners: rows.length, garmin: rows.filter((r) => !!r.garmin_auth).length, academy: rows.filter((r) => r.is_academy).length };
}

// ── Lock ────────────────────────────────────────────────────────────────────

/** One lock per (week, athlete). Update-or-insert, since the key is no longer the PK after 198. */
export async function takeLock(db: Db, week: string, me: string, name: string | null, who: Who = null) {
  const row = await readLock(db, week, who);
  if (!mayTakeLock(row, me)) return { ok: false as const, lock: lockView(row, me) };
  const keepRequest = row?.editor_id === me;
  const patch = {
    editor_id: me, editor_name: name, heartbeat_at: new Date().toISOString(),
    release_requested_by: keepRequest ? row?.release_requested_by ?? null : null,
    release_requested_at: keepRequest ? row?.release_requested_at ?? null : null,
  };
  if (row) {
    // Night queue #64: taking over a stale lock is conditional on the row still being the one we read
    // (same editor, same heartbeat). Two coaches taking the same stale lock at once: one update matches,
    // the other matches nothing and is answered as a held lock instead of both being told ok.
    const taken = await scoped<Array<{ editor_id: string }> | null>(who, (sc) => {
      const q: any = db.from('plan_edit_locks').update(patch).eq('week_start', week)
        .eq('editor_id', row.editor_id).eq('heartbeat_at', row.heartbeat_at);
      return (sc ? scopeTo(q, who) : q).select('editor_id');
    });
    if (!taken || taken.length === 0) {
      const now = await readLock(db, week, who);
      return { ok: now?.editor_id === me, lock: lockView(now, me) };
    }
  } else {
    try {
      await scoped(who, (sc) => db.from('plan_edit_locks').insert({ week_start: week, ...patch, ...(sc && who ? { athlete_id: who } : {}) }));
    } catch (e: any) {
      // Two coaches taking a free lock at once: the unique (week, athlete) key lets one
      // insert win (23505 for the other). The loser re-reads, exactly like a held lock.
      if (!/duplicate key|23505/.test(e?.message || '')) throw e;
      const now = await readLock(db, week, who);
      return { ok: now?.editor_id === me, lock: lockView(now, me) };
    }
  }
  return { ok: true as const, lock: lockView(await readLock(db, week, who), me) };
}
export async function releaseLock(db: Db, week: string, me: string, who: Who = null) {
  await scoped(who, (sc) => {
    const q = db.from('plan_edit_locks').delete().eq('week_start', week).eq('editor_id', me);
    return sc ? scopeTo(q as any, who) : q;
  });
}
export async function requestRelease(db: Db, week: string, me: string, myName: string, who: Who = null) {
  const row = await readLock(db, week, who);
  if (!row || lockView(row, me).state !== 'other') return false;
  await scoped(who, (sc) => {
    const q = db.from('plan_edit_locks').update({ release_requested_by: myName, release_requested_at: new Date().toISOString() }).eq('week_start', week);
    return sc ? scopeTo(q as any, who) : q;
  });
  await notifyAthlete({ athleteId: row.editor_id, kind: 'plan_lock_release', category: 'management', url: '/coach/plan', title: 'בקשה לסיים עריכה', body: `${myName} מבקש/ת לערוך את תוכנית השבוע` }).catch(() => {});
  return true;
}

// ── Publish ─────────────────────────────────────────────────────────────────

async function athletesForPush(db: Db, groups: GroupNo[] | null, who: Who = null) {
  let q = db.from('athletes').select('id, name, garmin_auth, is_academy, group_id, groups!group_id(name, pace_profile)');
  // A trainee week reaches that trainee only — and only while active: a removed trainee is
  // neither pushed nor notified.
  q = who ? q.eq('id', who).eq('status', 'active') : q.eq('status', 'active');
  const rows = (check(await q) as any[]) || [];
  if (who) return rows;
  return rows
    .map((a) => ({ ...a, groupNo: (resolveGroup(a.groups?.name).index + 1) as GroupNo | 0 }))
    .filter((a) => !groups || (a.groupNo && groups.includes(a.groupNo)));
}

/** The weekly_plans row a version publishes into: the group row, or the trainee's newest own row. */
async function legacyRowOf(db: Db, week: string, who: Who): Promise<string | null> {
  // Night queue #62: the group week used maybeSingle() with no coach filter, so a duplicate row (two coaches'
  // weeks, or a race between two first publishes) answered PGRST116 → 500. Same shape as the trainee branch now:
  // this coach's rows, newest first, one.
  if (!who) {
    const groups = check(await db.from('weekly_plans').select('id, created_at').eq('coach_id', COACH_ID).eq('week_start_date', week).is('athlete_id', null).order('created_at', { ascending: false }).limit(1)) as any[];
    return groups?.[0]?.id ?? null;
  }
  const rows = check(await db.from('weekly_plans').select('id, created_at').eq('coach_id', COACH_ID).eq('athlete_id', who).eq('week_start_date', week).order('created_at', { ascending: false })) as any[];
  return rows?.[0]?.id ?? null;
}

async function writeLegacyPlan(db: Db, week: string, body: ParsedWeeklyPlan, status: string, who: Who = null) {
  const row: { coach_id: string; week_start_date: string; parsed_workouts: any; status: string; athlete_id?: string; original_input?: string } =
    { coach_id: COACH_ID, week_start_date: week, parsed_workouts: normalizeParsedWorkouts(body), status };
  const existing = await legacyRowOf(db, week, who);
  const saved = existing
    ? check(await db.from('weekly_plans').update(row).eq('id', existing).select('id').single())
    : check(await db.from('weekly_plans').insert(who ? { ...row, athlete_id: who, original_input: '[built in-app]' } : row as typeof row).select('id').single());
  revalidateWeeklyPlans();
  return (saved as any).id as string;
}

export async function publishVersion(db: Db, v: VersionRow, opts: PublishOpts, by: string | null) {
  const who: Who = v.athlete_id ?? null;
  const vs = await versionsFor(db, v.week_start, who);
  const prev = live(vs);
  const changes = prev ? diffPlans(prev.body, v.body) : null;
  const scope = who ? null : changes ? affectedGroups(changes, opts.scope ?? CHANGE_NOTICE_SCOPE) : null; // null = first publish, everyone

  const planId = await writeLegacyPlan(db, v.week_start, v.body, 'published', who);
  if (prev && prev.id !== v.id) await db.from('weekly_plan_versions').update({ state: 'superseded' }).eq('id', prev.id);
  await db.from('weekly_plan_versions').update({
    state: 'published', plan_id: planId, published_at: new Date().toISOString(), published_by: by, publish_opts: opts,
  }).eq('id', v.id);

  const targets = await athletesForPush(db, scope, who);
  if (opts.notify) {
    const body = (opts.message || (changes ? changeMessage(changes) : 'התוכנית לשבוע הבא עלתה')).slice(0, 400);
    await Promise.allSettled(targets.map((a) => notifyAthlete({
      athleteId: a.id, kind: changes ? 'plan_changed' : 'plan_published', category: 'program', url: '/today',
      title: changes ? 'עדכון בתוכנית' : 'תוכנית חדשה', body,
    })));
    // The staff copy is about the club's week; a trainee's own week is their coach's business.
    if (changes && !who) {
      const staff = (await recipientsForKind('plan_changed', db)) ?? [];
      await Promise.allSettled(staff.filter((id) => id !== by).map((id) => notifyAthlete({
        athleteId: id, kind: 'plan_changed', category: 'management', url: '/coach/plan', title: 'התוכנית עודכנה', body,
      })));
    }
  }
  // "Notify me when the plan is published" (opt-in category plan_ready): every first publish of a week,
  // whether or not the coach ticked notify. Category prefs and quiet hours apply in notifyAthlete's send path.
  if (!changes) await notifyPlanReady(db, v.week_start, targets.map((a) => a.id));
  // DEFAULT_OVERWRITE_WATCH: a change reaches watches only when the coach asks for it.
  const push = opts.push && (!prev || opts.overwriteWatch);
  if (push) await pushToAthletes(db, { ...v, plan_id: planId }, targets);
  return { planId, scope, notified: opts.notify ? targets.length : 0, pushed: push ? targets.length : 0 };
}

export async function pushToAthletes(db: Db, v: VersionRow, athletes: any[]) {
  const { paceAlerts } = await loadAcademySettings();
  const workouts = normalizeWorkoutParts(v.body).workouts;
  const queue = [...athletes];
  const work = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const prior = check(await db.from('plan_push_status').select('attempts').eq('athlete_id', a.id).eq('version_id', v.id).maybeSingle()) as any;
      const attempts = (prior?.attempts ?? 0) + 1;
      if (!a.garmin_auth) {
        await db.from('plan_push_status').upsert({ athlete_id: a.id, version_id: v.id, state: 'skipped', error_code: 'no_garmin', attempts, updated_at: new Date().toISOString() });
        continue;
      }
      let state = 'sent', code: string | null = null, error: string | null = null, retry: string | null = null;
      try {
        // paceTarget stays driven by is_academy (CLAUDE.md "Garmin integration").
        const r = await pushWeekToAthlete({ supabase: db, athlete: a, plannedWorkouts: workouts, weekStartDate: v.week_start, planId: v.plan_id, paceTarget: !!a.is_academy && paceAlerts });
        if (r.status !== 'success') ({ state, code } = classifyPushError(r.error)), (error = r.error ?? null);
      } catch (e: any) { ({ state, code } = classifyPushError(e?.message)); error = String(e?.message || e); }
      if (state === 'backoff') retry = nextRetryAt(attempts);
      await db.from('plan_push_status').upsert({ athlete_id: a.id, version_id: v.id, state, error_code: code, error, attempts, retry_at: retry, updated_at: new Date().toISOString() });
    }
  };
  await Promise.all([work(), work(), work()]);
}

export async function pushSummary(db: Db, versionId: string) {
  const rows = (check(await db.from('plan_push_status').select('athlete_id, state, error_code, attempts, retry_at, updated_at, athletes!athlete_id(name, is_academy)').eq('version_id', versionId)) as any[]) || [];
  const athletes = rows.map((r) => ({ athleteId: r.athlete_id, name: r.athletes?.name ?? '', academy: !!r.athletes?.is_academy, state: r.state, errorCode: r.error_code, attempts: r.attempts, retryAt: r.retry_at }));
  const count = (s: string) => athletes.filter((a) => a.state === s).length;
  return { versionId, sent: count('sent'), failed: count('failed'), reconnect: count('reconnect'), backoff: count('backoff'), pending: count('pending'), athletes };
}

export async function retryPush(db: Db, versionId: string, athleteIds: string[] | null) {
  const v = check(await db.from('weekly_plan_versions').select('*').eq('id', versionId).single()) as VersionRow;
  let targets = await athletesForPush(db, null, v.athlete_id ?? null);
  const ids = athleteIds ?? ((check(await db.from('plan_push_status').select('athlete_id').eq('version_id', versionId).not('state', 'in', '(sent,skipped)')) as any[]) || []).map((r) => r.athlete_id);
  targets = targets.filter((a) => ids.includes(a.id));
  await pushToAthletes(db, v, targets);
  return pushSummary(db, versionId);
}

export async function unpublish(db: Db, week: string, who: Who = null) {
  const vs = await versionsFor(db, week, who);
  const p = live(vs);
  if (!p) return false;
  await writeLegacyPlan(db, week, p.body, 'draft', who);
  await db.from('weekly_plan_versions').update({ state: 'unpublished' }).eq('id', p.id);
  return true;
}

export function defaultOpts(o: Partial<PublishOpts> = {}): PublishOpts {
  return { notify: o.notify ?? true, push: o.push ?? true, overwriteWatch: o.overwriteWatch ?? DEFAULT_OVERWRITE_WATCH, message: o.message ?? null,
    scope: o.scope === 'everyone' || o.scope === 'affected' ? o.scope : CHANGE_NOTICE_SCOPE };
}

/** cron/tick: publish every scheduled version whose time has come. Never throws. */
export async function runScheduledPlanPublishes(db: Db, now = new Date()): Promise<string[]> {
  // Group and trainee versions alike: each carries its own athlete_id into publishVersion,
  // which scopes the supersede and the weekly_plans write by it.
  const { data, error } = await db.from('weekly_plan_versions').select('*').eq('state', 'scheduled').lte('publish_at', now.toISOString());
  const fired: string[] = [];
  // No early return: a tick with nothing due to publish must still run the expired retries below.
  for (const v of (error ? [] : (data as VersionRow[] | null) ?? [])) {
    try { await publishVersion(db, v, defaultOpts(v.publish_opts ?? {}), null); fired.push(`planPublish ${v.week_start}${v.athlete_id ? ` athlete ${v.athlete_id}` : ''} v${v.version}`); }
    catch (e) { console.error('[plan-builder] scheduled publish failed', v.id, e); }
  }
  // Retries whose backoff expired.
  const due = await db.from('plan_push_status').select('version_id, athlete_id').eq('state', 'backoff').lte('retry_at', now.toISOString());
  const byVersion = new Map<string, string[]>();
  for (const r of (due.data as any[]) || []) byVersion.set(r.version_id, [...(byVersion.get(r.version_id) || []), r.athlete_id]);
  for (const [vid, ids] of byVersion) {
    try {
      // Automatic retries only push the week's CURRENT published version (2026-11-22). A backoff
      // row can point at a version since superseded or unpublished; pushing that body would
      // replace the athlete's same-day workouts with a plan the coach withdrew. Such rows are
      // closed as skipped/stale_version so they stop retrying. Manual retryPush is unchanged.
      const { data: v, error: vErr } = await db.from('weekly_plan_versions').select('*').eq('id', vid).maybeSingle();
      // A failed lookup is not evidence of staleness: no push and no row update, so the
      // pending retry survives to the next tick. (versionsFor throws on its own errors,
      // which the catch below turns into the same "leave it alone".)
      if (vErr) { fired.push(`planPushRetryDeferred ${ids.length}`); continue; }
      const row = v as VersionRow | null;
      const current = row ? live(await versionsFor(db, row.week_start, row.athlete_id ?? null)) : null;
      if (!current || current.id !== vid) {
        await db.from('plan_push_status').update({ state: 'skipped', error_code: 'stale_version', retry_at: null, updated_at: new Date().toISOString() })
          .eq('version_id', vid).eq('state', 'backoff');
        fired.push(`planPushRetrySkippedStale ${ids.length}`);
        continue;
      }
      await retryPush(db, vid, ids);
      fired.push(`planPushRetry ${ids.length}`);
    } catch {}
  }
  return fired;
}

// ── Academy writers (day-plan, copy-week, pace re-resolve) ──────────────────
//
// The academy's per-day and per-week tools write a trainee's week through here, so the
// builder stays the ONLY plan writer (owner decision 2026-11-22). Each write is recorded as
// a published version of that trainee's stream, so the builder's view of the week is the
// week the trainee actually has. The delivery-status updates after a Garmin push go through
// `setIndividualPlanStatus` for the same reason.

export interface IndividualWrite {
  athleteId: string;
  weekStart: string;
  /** Already normalized (`normalizeParsedWorkouts`). */
  parsed: ParsedWeeklyPlan;
  status: string;
  /** false: an existing row keeps its status (a re-price with nothing sent). */
  setStatusOnUpdate?: boolean;
  by?: string | null;
  /** The trainee's row the caller already read (day-plan); else the newest row is looked up. */
  planId?: string | null;
}

export async function writeIndividualWeek(db: Db, w: IndividualWrite): Promise<{ planId: string | null; error: string | null }> {
  if (!w.athleteId) return { planId: null, error: 'athleteId required' }; // never the group row
  let existing: string | null;
  try { existing = w.planId ?? await legacyRowOf(db, w.weekStart, w.athleteId); }
  catch (e: any) { return { planId: null, error: e?.message ?? 'read failed' }; }
  const saved = existing
    ? await db.from('weekly_plans').update({ parsed_workouts: w.parsed, ...(w.setStatusOnUpdate === false ? {} : { status: w.status }) }).eq('athlete_id', w.athleteId).eq('id', existing).select('id').single()
    : await db.from('weekly_plans').insert({
      coach_id: COACH_ID, week_start_date: w.weekStart, original_input: '[built in-app]',
      parsed_workouts: w.parsed, status: w.status, athlete_id: w.athleteId,
    }).select('id').single();
  if (saved.error || !saved.data) return { planId: null, error: saved.error?.message ?? 'save failed' };
  const planId = String((saved.data as any).id);
  // A re-price that kept the row's status (setStatusOnUpdate:false, nothing sent) is not a
  // publish: recording one would supersede the live version and cancel a SCHEDULED trainee
  // publish back to draft (QA 23.11 #5). The row is updated; the version stream is left alone.
  if (existing && w.setStatusOnUpdate === false) return { planId, error: null };
  await recordIndividualVersion(db, w.athleteId, w.weekStart, w.parsed, planId, w.by ?? null);
  return { planId, error: null };
}

/**
 * A write made outside the builder, recorded as the published version of its stream
 * (`who` null = the group week, a uuid = that trainee's week). A builder draft in progress
 * is left as a draft (it is newer intent); a previous published version is superseded; a
 * SCHEDULED version has its schedule cancelled (kept as the draft) so it cannot publish
 * later and silently wipe this write. A concurrent version insert (23505) re-reads and
 * retries once. Best effort before migration 198: a missing column skips the record, never
 * the write — and a trainee record never touches the group stream.
 */
/** JSON with object keys sorted at every level: jsonb does not keep key order, so a plain
 *  JSON.stringify of a stored body and an identical incoming one can differ. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}

async function recordPublishedVersion(db: Db, who: Who, week: string, body: ParsedWeeklyPlan, planId: string, by: string | null, kind: string) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const vs = await versionsFor(db, week, who);
      const prev = live(vs);
      // A status-only save (same workouts) is not a new version.
      if (prev && stableJson(prev.body) === stableJson(body)) return;
      const now = new Date().toISOString();
      const ins = await db.from('weekly_plan_versions').insert({
        week_start: week, ...(who ? { athlete_id: who } : {}), version: (vs[0]?.version ?? 0) + 1, body, state: 'published',
        plan_id: planId, published_at: now, published_by: by, created_by: by, source: { kind },
      }).select('id').single();
      if (ins.error) {
        if (attempt === 0 && (ins.error.code === '23505' || /duplicate key/.test(ins.error.message || ''))) continue;
        throw new Error(ins.error.message);
      }
      if (prev) await db.from('weekly_plan_versions').update({ state: 'superseded' }).eq('id', prev.id);
      const pending = draftOf(vs);
      if (pending?.state === 'scheduled') {
        await db.from('weekly_plan_versions').update({ state: 'draft', publish_at: null }).eq('id', pending.id).eq('state', 'scheduled');
      }
      return;
    }
  } catch (e) {
    if (!(e instanceof MigrationPending)) console.error('[plan-builder] version record failed', kind, who, week, e);
  }
}
const recordIndividualVersion = (db: Db, who: string, week: string, body: ParsedWeeklyPlan, planId: string, by: string | null) =>
  recordPublishedVersion(db, who, week, body, planId, by, 'academy');

/** weekly_plans statuses that mean "the athletes have this plan" (a draft is not recorded). */
const SENT_STATUSES = new Set(['published', 'pushed', 'partial']);

/**
 * Option C (owner decision 2026-11-22): the PWA's plan routes (`/api/plans` POST/PUT,
 * `plans/import-program`, `plans/reimport`) keep writing weekly_plans as before, and each
 * sent write is ALSO recorded as a builder version — so the builder's history is complete
 * and a builder publish diffs against what athletes actually have. Never throws: the
 * route's own write already succeeded and is the plan athletes follow.
 */
export async function recordLegacyPlanWrite(db: Db, w: { weekStart: string; athleteId?: string | null; parsed: any; status: string | null | undefined; planId: string; by?: string | null; kind: string }) {
  try {
    if (!w.status || !SENT_STATUSES.has(w.status)) return;
    // The builder's body is one { workouts } (lane paces in the notation); a grouped row's
    // group1 carries that notation — the same reading copyLastWeek's legacy fallback uses.
    const body = legacyBody(w.parsed);
    if (!body || !Array.isArray(body.workouts)) return;
    await recordPublishedVersion(db, w.athleteId || null, String(w.weekStart).slice(0, 10), body, w.planId, w.by ?? null, w.kind);
  } catch (e) { console.error('[plan-builder] legacy record failed', e); }
}

/** Delivery status of a trainee's weekly_plans row after a push (`pushed` / `partial` / …). */
export async function setIndividualPlanStatus(db: Db, planId: string, status: string) {
  // planId only ever comes from writeIndividualWeek, which writes trainee rows only.
  await db.from('weekly_plans').update({ status }).eq('id', planId);
}

/** Members who opted in to `plan_ready` get one push when a week's plan first goes live. */
export async function notifyPlanReady(db: Db, week: string, ids: string[]) {
  if (!ids.length) return 0;
  const { data, error } = await db.from('athletes').select('id, notification_prefs').in('id', ids);
  if (error) return 0;
  const want = (data || []).filter((a: { notification_prefs: Record<string, unknown> | null }) => a.notification_prefs?.plan_ready === true);
  await Promise.allSettled(want.map((a: { id: string }) => notifyAthlete({
    athleteId: a.id, kind: 'plan_ready', category: 'plan_ready', url: '/today',
    title: 'התוכנית לשבוע עלתה', body: `התוכנית לשבוע של ${week.split('-').reverse().slice(0, 2).join('.')} מחכה לך`,
  })));
  return want.length;
}
