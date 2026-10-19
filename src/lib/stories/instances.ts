import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryFeature, StorySettingsRow } from './gate';

/**
 * Per-athlete story overrides (story_instances, migration 157): one row per
 * athlete × feature × period. `period` is the occurrence date — the birthday, Dec 31
 * for the annual, the Saturday for the weekly.
 *
 * THE RULE: an override can only NARROW what storyGate opened. `enabled=false` or
 * `skipped` closes one person's story; `feed_post=false` drops the public post; nothing
 * here opens a story the gate keeps closed, and `feed_post=true` can't turn on a post
 * the feature's own switch has off. The two things an override may stretch are WHEN
 * (publish_at, never in the past) and HOW LONG (display_days, capped at 31) — and
 * `enabled=true`, which waives the min-runs data threshold for that one person, but
 * still only behind the gate.
 *
 * Everything degrades when the table is missing (157 not pasted): no overrides, no
 * marks, the ledger alone keeps the cron idempotent.
 */

export interface CustomText { headline?: string | null; push_title?: string | null; push_body?: string | null }

export interface StoryInstance {
  id?: string;
  athlete_id: string;
  feature: StoryFeature;
  period: string;
  publish_at: string | null;
  display_days: number | null;
  feed_post: boolean | null;
  custom_text: CustomText | null;
  slide_order: string[] | null;
  enabled: boolean | null;
  skipped: boolean;
  updated_by?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
  viewed_at?: string | null;
  shared_at?: string | null;
}

/** The overrides an admin may set. Anything else in a PATCH body is ignored. */
export type Overrides = Partial<Pick<StoryInstance, 'publish_at' | 'display_days' | 'feed_post' | 'custom_text' | 'slide_order' | 'enabled' | 'skipped'>>;

/** How long after publish the push may still go out (a late tick, a story turned on late). */
export const PUSH_GRACE_MS = 3 * 3600_000;

/** Israel wall-clock (date + HH:MM) → the UTC instant, DST-aware. */
export function israelWallToUtc(dateIso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10), h || 0, m || 0);
  // Israel's offset at that moment (2 or 3 hours), read back from Intl.
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The default publish moment of an occurrence: its date at the feature's generate_at. */
export function defaultPublishAt(settings: Pick<StorySettingsRow, 'generate_at'>, period: string): Date {
  return israelWallToUtc(period, (settings.generate_at || '07:00').slice(0, 5));
}

export interface Effective {
  /** The person's story is on (gate permitting). */
  on: boolean;
  /** Why it is off for this person, when it is. */
  reason: null | 'skipped' | 'disabled' | 'min_runs';
  publishAt: Date;
  displayDays: number;
  until: Date;
  feedPost: boolean;
  customText: CustomText | null;
  slideOrder: string[] | null;
  /** The non-default overrides, for the chip under the row. */
  overridden: Array<'publish_at' | 'display_days' | 'feed_post' | 'custom_text' | 'slide_order' | 'enabled'>;
}

/**
 * Settings + one instance (or none) → what applies to this person. Narrow-only:
 * `feedPost` is settings AND instance; `on` is closed by skipped / enabled=false and by
 * fewer runs than min_runs unless the admin waived it (enabled=true).
 */
export function effectiveFor(settings: StorySettingsRow, period: string, inst: Partial<StoryInstance> | null, runs: number | null = null): Effective {
  const overridden: Effective['overridden'] = [];
  const publishAt = inst?.publish_at ? new Date(inst.publish_at) : defaultPublishAt(settings, period);
  if (inst?.publish_at) overridden.push('publish_at');
  const displayDays = Math.min(31, Math.max(1, inst?.display_days ?? settings.display_days ?? 7));
  if (inst?.display_days != null) overridden.push('display_days');
  if (inst?.feed_post != null) overridden.push('feed_post');
  if (inst?.custom_text && Object.values(inst.custom_text).some((v) => typeof v === 'string' && v.trim())) overridden.push('custom_text');
  if (inst?.slide_order?.length) overridden.push('slide_order');
  if (inst?.enabled != null) overridden.push('enabled');
  let reason: Effective['reason'] = null;
  if (inst?.skipped) reason = 'skipped';
  else if (inst?.enabled === false) reason = 'disabled';
  else if (runs != null && runs < (settings.min_runs ?? 1) && inst?.enabled !== true) reason = 'min_runs';
  return {
    on: reason === null,
    reason,
    publishAt,
    displayDays,
    until: new Date(publishAt.getTime() + displayDays * 86_400_000),
    feedPost: settings.feed_post === true && inst?.feed_post !== false,
    customText: inst?.custom_text ?? null,
    slideOrder: inst?.slide_order ?? null,
    overridden,
  };
}

/** May the story be on screen now (the gate already said yes)? publish ≤ now < until. */
export const visibleAt = (e: Effective, now: Date) => e.on && now >= e.publishAt && now < e.until;

/** May the push go out on this tick? Within the grace after publish, and not pushed yet. */
export const pushDueAt = (e: Effective, now: Date, pushedAt: string | null | undefined) =>
  e.on && !pushedAt && now >= e.publishAt && now.getTime() < e.publishAt.getTime() + PUSH_GRACE_MS;

/**
 * Checks and cleans a PATCH body. A publish time in the past is refused (edge case #16):
 * nothing would send, and the sheet must say so instead of saving it quietly.
 */
export function validateOverrides(body: Record<string, unknown>, now: Date, opts: { allowPast?: boolean } = {}): { ok: true; value: Overrides } | { ok: false; error: string } {
  const v: Overrides = {};
  if ('publish_at' in body) {
    if (body.publish_at === null) v.publish_at = null;
    else {
      const t = typeof body.publish_at === 'string' ? Date.parse(body.publish_at) : NaN;
      if (!Number.isFinite(t)) return { ok: false, error: 'bad publish_at' };
      if (!opts.allowPast && t < now.getTime() - 60_000) return { ok: false, error: 'publish_at in the past' };
      v.publish_at = new Date(t).toISOString();
    }
  }
  if ('display_days' in body) {
    if (body.display_days === null) v.display_days = null;
    else {
      const n = Number(body.display_days);
      if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: 'display_days 1-31' };
      v.display_days = n;
    }
  }
  for (const k of ['feed_post', 'enabled'] as const) {
    if (k in body) {
      if (body[k] !== null && typeof body[k] !== 'boolean') return { ok: false, error: `bad ${k}` };
      v[k] = body[k] as boolean | null;
    }
  }
  if ('skipped' in body) {
    if (typeof body.skipped !== 'boolean') return { ok: false, error: 'bad skipped' };
    v.skipped = body.skipped;
  }
  if ('custom_text' in body) {
    if (body.custom_text === null) v.custom_text = null;
    else if (typeof body.custom_text === 'object') {
      const c = body.custom_text as Record<string, unknown>;
      const clean = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
      v.custom_text = { headline: clean(c.headline, 80), push_title: clean(c.push_title, 60), push_body: clean(c.push_body, 160) };
    } else return { ok: false, error: 'bad custom_text' };
  }
  if ('slide_order' in body) {
    if (body.slide_order === null) v.slide_order = null;
    else if (Array.isArray(body.slide_order) && body.slide_order.every((x) => typeof x === 'string')) v.slide_order = (body.slide_order as string[]).slice(0, 20);
    else return { ok: false, error: 'bad slide_order' };
  }
  return { ok: true, value: v };
}

/** The sheet's quick chips, as overrides on top of the current effective values. */
export function quickAction(action: 'plus_day' | 'postpone' | 'skip_year' | 'unskip', e: Effective, now: Date): Overrides {
  if (action === 'plus_day') return { display_days: Math.min(31, e.displayDays + 1) };
  if (action === 'skip_year') return { skipped: true };
  if (action === 'unskip') return { skipped: false };
  // דחה למחר: one day later than it would go out — and never into the past.
  const next = new Date(e.publishAt.getTime() + 86_400_000);
  const floor = new Date(now.getTime() + 86_400_000);
  return { publish_at: (next > now ? next : floor).toISOString() };
}

/** The chip under an upcoming row: "מותאם: 07:30 · 14 ימים · כותרת אישית", or "ברירת מחדל". */
export function overrideSummary(e: Effective): string {
  if (e.reason === 'skipped') return 'דילוג השנה';
  if (e.reason === 'disabled') return 'כבוי לאדם הזה';
  const parts: string[] = [];
  if (e.overridden.includes('publish_at')) {
    parts.push(new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(e.publishAt));
  }
  if (e.overridden.includes('display_days')) parts.push(`${e.displayDays} ימים`);
  if (e.overridden.includes('custom_text')) parts.push('כותרת אישית');
  if (e.overridden.includes('feed_post') && !e.feedPost) parts.push('בלי פוסט');
  return parts.length ? `מותאם: ${parts.join(' · ')}` : 'ברירת מחדל';
}

type Db = SupabaseClient;
const isMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /story_instances/.test(e.message || ''));

/** Instances for (feature, periods), keyed `${athleteId}:${period}`. Missing table = none. */
export async function readInstances(db: Db, feature: StoryFeature, periods: string[]): Promise<{ map: Map<string, StoryInstance>; ready: boolean }> {
  const map = new Map<string, StoryInstance>();
  if (periods.length === 0) return { map, ready: true };
  const { data, error } = await db.from('story_instances').select('*').eq('feature', feature).in('period', Array.from(new Set(periods)));
  if (error) {
    if (isMissing(error)) return { map, ready: false };
    throw error;
  }
  for (const r of (data || []) as StoryInstance[]) map.set(`${r.athlete_id}:${r.period}`, r);
  return { map, ready: true };
}

export async function readInstance(db: Db, athleteId: string, feature: StoryFeature, period: string): Promise<StoryInstance | null> {
  const { data, error } = await db.from('story_instances').select('*')
    .eq('athlete_id', athleteId).eq('feature', feature).eq('period', period).maybeSingle();
  if (error) return null;
  return (data as StoryInstance | null) ?? null;
}

/** Upsert overrides on the unique key. `false` when the table is missing or the write fails. */
export async function writeOverrides(db: Db, athleteId: string, feature: StoryFeature, period: string, o: Overrides, by: string | null): Promise<boolean> {
  const { error } = await db.from('story_instances').upsert(
    { athlete_id: athleteId, feature, period, ...o, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: 'athlete_id,feature,period' },
  );
  return !error;
}

/** "בטל שינויים": every override back to NULL (the marks stay). */
export async function resetOverrides(db: Db, athleteId: string, feature: StoryFeature, period: string, by: string | null): Promise<boolean> {
  const { error } = await db.from('story_instances').update({
    publish_at: null, display_days: null, feed_post: null, custom_text: null, slide_order: null, enabled: null, skipped: false,
    updated_by: by, updated_at: new Date().toISOString(),
  }).eq('athlete_id', athleteId).eq('feature', feature).eq('period', period);
  return !error;
}

/**
 * Claims the push for one instance, once: creates the row if needed (the unique key
 * absorbs a second tick), then sets pushed_at only where it is still NULL. `'claimed'`
 * = this caller sends; `'taken'` = another tick did; `'no_table'` = 157 not pasted (the
 * caller falls back to its ledger tag).
 */
export async function claimPush(db: Db, athleteId: string, feature: StoryFeature, period: string, now: Date): Promise<'claimed' | 'taken' | 'no_table'> {
  const ins = await db.from('story_instances').upsert(
    { athlete_id: athleteId, feature, period },
    { onConflict: 'athlete_id,feature,period', ignoreDuplicates: true },
  );
  if (ins.error) return isMissing(ins.error) ? 'no_table' : 'taken';
  const { data, error } = await db.from('story_instances').update({ pushed_at: now.toISOString() })
    .eq('athlete_id', athleteId).eq('feature', feature).eq('period', period).is('pushed_at', null)
    .select('id');
  if (error) return isMissing(error) ? 'no_table' : 'taken';
  return (data || []).length > 0 ? 'claimed' : 'taken';
}

/** viewed_at / shared_at, first time only. Never for a preview or a view-as (edge case #22). */
export async function markSeen(db: Db, athleteId: string, feature: StoryFeature, period: string, mark: 'viewed_at' | 'shared_at', ctx: { preview: boolean; viewingAs: boolean }): Promise<boolean> {
  if (ctx.preview || ctx.viewingAs) return false;
  await db.from('story_instances').upsert({ athlete_id: athleteId, feature, period }, { onConflict: 'athlete_id,feature,period', ignoreDuplicates: true });
  const { error } = await db.from('story_instances').update({ [mark]: new Date().toISOString() })
    .eq('athlete_id', athleteId).eq('feature', feature).eq('period', period).is(mark, null);
  return !error;
}

/**
 * The one door every story push goes through. A preview (an admin's look, a super-user's
 * view-as) must never reach a phone — this throws rather than trusting every caller.
 */
export function assertNotPreview(ctx: { preview?: boolean; viewingAs?: boolean }) {
  if (ctx.preview || ctx.viewingAs) throw new Error('story push refused: preview / view-as never sends');
}
