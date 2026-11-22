import { createServerClient } from '@/lib/supabase/server';
import { parseWorkoutPlan, EmptyParseError } from '@/lib/ai/parser';
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

// ── Versions ────────────────────────────────────────────────────────────────

export async function versionsFor(db: Db, week: string): Promise<VersionRow[]> {
  return (check(await db.from('weekly_plan_versions').select('*').eq('week_start', week).order('version', { ascending: false })) as VersionRow[]) || [];
}
const live = (vs: VersionRow[]) => vs.find((v) => v.state === 'published') || null;
const draftOf = (vs: VersionRow[]) => vs.find((v) => v.state === 'draft' || v.state === 'scheduled') || null;

export async function readLock(db: Db, week: string): Promise<LockRow | null> {
  return check(await db.from('plan_edit_locks').select('*').eq('week_start', week).maybeSingle()) as LockRow | null;
}

export async function weekState(db: Db, week: string, me: string) {
  const [vs, lock] = await Promise.all([versionsFor(db, week), readLock(db, week)]);
  const published = live(vs), draft = draftOf(vs);
  const changes = published && draft ? diffPlans(published.body, draft.body) : [];
  const push = published ? await pushSummary(db, published.id) : null;
  return {
    week, published, draft, audience: await audience(db),
    diff: { changes, groups: affectedGroups(changes), message: changeMessage(changes) },
    lock: lockView(lock, me), push,
    lastWeek: (await versionsFor(db, addDaysToDateStr(week, -7))).some((v) => v.state === 'published'),
  };
}

export async function saveDraft(db: Db, week: string, body: ParsedWeeklyPlan, by: string) {
  const vs = await versionsFor(db, week);
  const clean = stripAnnotations(body as any);
  const draft = draftOf(vs);
  if (draft) {
    return check(await db.from('weekly_plan_versions').update({ body: clean, state: 'draft', publish_at: null }).eq('id', draft.id).select('*').single()) as VersionRow;
  }
  return check(await db.from('weekly_plan_versions')
    .insert({ week_start: week, version: (vs[0]?.version ?? 0) + 1, body: clean, state: 'draft', created_by: by, plan_id: live(vs)?.plan_id ?? null })
    .select('*').single()) as VersionRow;
}

export async function copyLastWeek(db: Db, week: string, by: string) {
  const prev = live(await versionsFor(db, addDaysToDateStr(week, -7)));
  let body = prev?.body as ParsedWeeklyPlan | undefined;
  if (!body) {
    // Fallback to the legacy table: a week published before the builder existed.
    const { data } = await db.from('weekly_plans').select('parsed_workouts').eq('week_start_date', addDaysToDateStr(week, -7)).is('athlete_id', null).eq('status', 'published').maybeSingle();
    const pw: any = data?.parsed_workouts;
    body = pw?.workouts ? pw : pw?.group1 ? pw.group1 : undefined;
  }
  if (!body) return null;
  return saveDraft(db, week, shiftPaces(body, COPY_LAST_WEEK_PACE_SHIFT_SEC), by);
}

/** Who a publish reaches: the sentence above the publish button. Counts only — never the credential. */
export async function audience(db: Db) {
  const { data } = await db.from('athletes').select('garmin_auth, is_academy').eq('status', 'active');
  const rows = (data as any[]) || [];
  return { runners: rows.length, garmin: rows.filter((r) => !!r.garmin_auth).length, academy: rows.filter((r) => r.is_academy).length };
}

// ── Lock ────────────────────────────────────────────────────────────────────

export async function takeLock(db: Db, week: string, me: string, name: string | null) {
  const row = await readLock(db, week);
  if (!mayTakeLock(row, me)) return { ok: false as const, lock: lockView(row, me) };
  const keepRequest = row?.editor_id === me;
  check(await db.from('plan_edit_locks').upsert({
    week_start: week, editor_id: me, editor_name: name, heartbeat_at: new Date().toISOString(),
    release_requested_by: keepRequest ? row?.release_requested_by ?? null : null,
    release_requested_at: keepRequest ? row?.release_requested_at ?? null : null,
  }));
  return { ok: true as const, lock: lockView(await readLock(db, week), me) };
}
export async function releaseLock(db: Db, week: string, me: string) {
  await db.from('plan_edit_locks').delete().eq('week_start', week).eq('editor_id', me);
}
export async function requestRelease(db: Db, week: string, me: string, myName: string) {
  const row = await readLock(db, week);
  if (!row || lockView(row, me).state !== 'other') return false;
  await db.from('plan_edit_locks').update({ release_requested_by: myName, release_requested_at: new Date().toISOString() }).eq('week_start', week);
  await notifyAthlete({ athleteId: row.editor_id, kind: 'plan_lock_release', category: 'management', url: '/coach/plan', title: 'בקשה לסיים עריכה', body: `${myName} מבקש/ת לערוך את תוכנית השבוע` }).catch(() => {});
  return true;
}

// ── Publish ─────────────────────────────────────────────────────────────────

async function athletesForPush(db: Db, groups: GroupNo[] | null) {
  const rows = (check(await db.from('athletes')
    .select('id, name, garmin_auth, is_academy, group_id, groups!group_id(name, pace_profile)')
    .eq('status', 'active')) as any[]) || [];
  return rows
    .map((a) => ({ ...a, groupNo: (resolveGroup(a.groups?.name).index + 1) as GroupNo | 0 }))
    .filter((a) => !groups || (a.groupNo && groups.includes(a.groupNo)));
}

async function writeLegacyPlan(db: Db, week: string, body: ParsedWeeklyPlan, status: 'published' | 'draft') {
  const row = { coach_id: COACH_ID, week_start_date: week, parsed_workouts: normalizeParsedWorkouts(body), status };
  const existing = check(await db.from('weekly_plans').select('id').eq('week_start_date', week).is('athlete_id', null).maybeSingle()) as any;
  const saved = existing
    ? check(await db.from('weekly_plans').update(row).eq('id', existing.id).select('id').single())
    : check(await db.from('weekly_plans').insert(row).select('id').single());
  revalidateWeeklyPlans();
  return (saved as any).id as string;
}

export async function publishVersion(db: Db, v: VersionRow, opts: PublishOpts, by: string | null) {
  const vs = await versionsFor(db, v.week_start);
  const prev = live(vs);
  const changes = prev ? diffPlans(prev.body, v.body) : null;
  const scope = changes ? affectedGroups(changes, opts.scope ?? CHANGE_NOTICE_SCOPE) : null; // null = first publish, everyone

  const planId = await writeLegacyPlan(db, v.week_start, v.body, 'published');
  if (prev) await db.from('weekly_plan_versions').update({ state: 'superseded' }).eq('id', prev.id);
  await db.from('weekly_plan_versions').update({
    state: 'published', plan_id: planId, published_at: new Date().toISOString(), published_by: by, publish_opts: opts,
  }).eq('id', v.id);

  const targets = await athletesForPush(db, scope);
  if (opts.notify) {
    const body = (opts.message || (changes ? changeMessage(changes) : 'התוכנית לשבוע הבא עלתה')).slice(0, 400);
    await Promise.allSettled(targets.map((a) => notifyAthlete({
      athleteId: a.id, kind: changes ? 'plan_changed' : 'plan_published', category: 'program', url: '/today',
      title: changes ? 'עדכון בתוכנית' : 'תוכנית חדשה', body,
    })));
    if (changes) {
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
  let targets = await athletesForPush(db, null);
  const ids = athleteIds ?? ((check(await db.from('plan_push_status').select('athlete_id').eq('version_id', versionId).not('state', 'in', '(sent,skipped)')) as any[]) || []).map((r) => r.athlete_id);
  targets = targets.filter((a) => ids.includes(a.id));
  await pushToAthletes(db, v, targets);
  return pushSummary(db, versionId);
}

export async function unpublish(db: Db, week: string) {
  const vs = await versionsFor(db, week);
  const p = live(vs);
  if (!p) return false;
  await writeLegacyPlan(db, week, p.body, 'draft');
  await db.from('weekly_plan_versions').update({ state: 'unpublished' }).eq('id', p.id);
  return true;
}

export function defaultOpts(o: Partial<PublishOpts> = {}): PublishOpts {
  return { notify: o.notify ?? true, push: o.push ?? true, overwriteWatch: o.overwriteWatch ?? DEFAULT_OVERWRITE_WATCH, message: o.message ?? null,
    scope: o.scope === 'everyone' || o.scope === 'affected' ? o.scope : CHANGE_NOTICE_SCOPE };
}

/** cron/tick: publish every scheduled version whose time has come. Never throws. */
export async function runScheduledPlanPublishes(db: Db, now = new Date()): Promise<string[]> {
  const { data, error } = await db.from('weekly_plan_versions').select('*').eq('state', 'scheduled').lte('publish_at', now.toISOString());
  const fired: string[] = [];
  // No early return: a tick with nothing due to publish must still run the expired retries below.
  for (const v of (error ? [] : (data as VersionRow[] | null) ?? [])) {
    try { await publishVersion(db, v, defaultOpts(v.publish_opts ?? {}), null); fired.push(`planPublish ${v.week_start} v${v.version}`); }
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
      const { data: v, error: vErr } = await db.from('weekly_plan_versions').select('id, week_start, state').eq('id', vid).maybeSingle();
      // A failed lookup is not evidence of staleness: no push and no row update, so the
      // pending retry survives to the next tick. (versionsFor throws on its own errors,
      // which the catch below turns into the same "leave it alone".)
      if (vErr) { fired.push(`planPushRetryDeferred ${ids.length}`); continue; }
      const current = v ? live(await versionsFor(db, (v as { week_start: string }).week_start)) : null;
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
