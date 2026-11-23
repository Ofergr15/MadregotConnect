/**
 * Drive photos v2 (night queue #101, owner "כן" 2026-11-23; flag `photos_drive_v2`, default off).
 *
 *  - The ONLY source is the session-photos folder "Madregot_After_2KM" (SESSION_PHOTOS_DRIVE_FOLDER_ID, photosRoot()).
 *    The old root (GOOGLE_DRIVE_FOLDER_ID) is kept for face tagging alone, which is off — nothing here reads it.
 *  - Staff can see whether the mirror is on and when it last ran (photosStatus), from the run the cron records.
 *  - Each folder is tied to what happened that day: the group plan's workout and the club's events (folderSessions).
 *
 * Reads only, plus the one telemetry row the cron writes (`photos_mirror_last_run`). It never changes
 * `photos_mirror` itself — that switch stays the owner's.
 */
import { COACH_ID } from '@/lib/constants';
import { planWeekStartOf } from '@/lib/utils';
import { extractWorkouts } from '@/lib/plans/workout-parsing';
import { photosRoot } from './drive-browse';

type Db = any;

export const MIRROR_SWITCH_KEY = 'photos_mirror';
export const MIRROR_LAST_RUN_KEY = 'photos_mirror_last_run';

export interface MirrorRun {
  at: string;
  ok: boolean;
  copied?: number;
  failed?: number;
  remaining?: number;
  warmed?: number;
  /** A short, fixed reason when the run threw — never the provider's text. */
  error?: string | null;
}

/** Called by cron/photos-mirror at the end of every run that got past the switch. Best effort. */
export async function recordMirrorRun(db: Db, run: MirrorRun): Promise<void> {
  try {
    await db.from('app_settings').upsert(
      { key: MIRROR_LAST_RUN_KEY, value: JSON.stringify(run), updated_at: run.at },
      { onConflict: 'key' },
    );
  } catch { /* telemetry: never fails the run */ }
}

export function parseMirrorRun(raw: unknown): MirrorRun | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MirrorRun>;
    if (typeof v?.at !== 'string') return null;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return {
      at: v.at, ok: v.ok === true,
      copied: n(v.copied), failed: n(v.failed), remaining: n(v.remaining), warmed: n(v.warmed),
      error: typeof v.error === 'string' ? v.error : null,
    };
  } catch { return null; }
}

export interface PhotosStatus {
  /** The session-photos folder is configured (the only source). */
  sourceConfigured: boolean;
  mirror: { on: boolean; lastRun: MirrorRun | null; /** Hours since the last run, rounded; null when never. */ hoursSince: number | null };
}

export async function photosStatus(db: Db, now = Date.now()): Promise<PhotosStatus> {
  const { data } = await db.from('app_settings').select('key, value').in('key', [MIRROR_SWITCH_KEY, MIRROR_LAST_RUN_KEY]);
  const rows = new Map(((data || []) as Array<{ key: string; value: string | null }>).map((r) => [r.key, r.value]));
  const lastRun = parseMirrorRun(rows.get(MIRROR_LAST_RUN_KEY));
  const t = lastRun ? Date.parse(lastRun.at) : NaN;
  return {
    sourceConfigured: !!photosRoot(),
    mirror: {
      on: rows.get(MIRROR_SWITCH_KEY) === 'on',
      lastRun,
      hoursSince: Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 3_600_000)) : null,
    },
  };
}

export interface FolderSession {
  /** The group plan's workout for that day (Sunday-anchored plan week), when there is one. */
  workout: { name: string; planId: string } | null;
  /** Club events on that day (multi-day camps included). */
  events: Array<{ id: string; name: string }>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * date (YYYY-MM-DD, a folder's `date`) → what the club did that day. The club week only: a folder is a club
 * session's photos, never one trainee's academy week. Drafts never count. Missing tables/columns → empty.
 */
export async function folderSessions(db: Db, dates: string[]): Promise<Map<string, FolderSession>> {
  const days = [...new Set(dates.filter((d) => ISO.test(d)))];
  const out = new Map<string, FolderSession>(days.map((d) => [d, { workout: null, events: [] }]));
  if (!days.length) return out;
  const weeks = [...new Set(days.map((d) => planWeekStartOf(d)))];
  const lo = days.reduce((a, b) => (a < b ? a : b));
  const hi = days.reduce((a, b) => (a > b ? a : b));
  const [plans, events] = await Promise.all([
    db.from('weekly_plans').select('id, week_start_date, parsed_workouts, status, created_at')
      .eq('coach_id', COACH_ID).is('athlete_id', null).in('week_start_date', weeks)
      .order('created_at', { ascending: false }),
    db.from('events').select('id, name, date, end_date').lte('date', hi).or(`end_date.gte.${lo},and(end_date.is.null,date.gte.${lo})`),
  ]);
  // Newest non-draft group row per week (the same row a runner is shown).
  const byWeek = new Map<string, { id: string; parsed_workouts: unknown }>();
  for (const p of ((plans?.data || []) as Array<{ id: string; week_start_date: string; parsed_workouts: unknown; status: string | null }>)) {
    if (p.status === 'draft' || byWeek.has(p.week_start_date)) continue;
    byWeek.set(p.week_start_date, p);
  }
  for (const d of days) {
    const plan = byWeek.get(planWeekStartOf(d));
    if (plan) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      const w = extractWorkouts(plan.parsed_workouts).find((x: any) => x?.dayOfWeek === dow);
      if (w && typeof (w as any).name === 'string' && (w as any).name.trim()) out.get(d)!.workout = { name: (w as any).name, planId: plan.id };
    }
  }
  for (const e of ((events?.data || []) as Array<{ id: string; name: string; date: string; end_date: string | null }>)) {
    for (const d of days) {
      if (e.date <= d && d <= (e.end_date || e.date)) out.get(d)!.events.push({ id: e.id, name: e.name });
    }
  }
  return out;
}
