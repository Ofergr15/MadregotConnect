/**
 * The last wellness sweep's summary, kept where it can be read back (app_settings key
 * `wellness_last_sweep`, a JSON string — no migration).
 *
 * The cron logs one `[wellness-sweep]` line per run, but the Vercel CLI shows only the
 * first log line of a request, so "the cron answered 200" could not be told apart from
 * "nights were stored". The summary is now also written here, returned by
 * /api/admin/trainee-data-coverage, and printed as one plain line on /dashboard/data-check.
 */
export const WELLNESS_LAST_SWEEP_KEY = 'wellness_last_sweep';

export interface WellnessSweepSummary {
  /** ISO instant the sweep finished. */
  at: string;
  athletes: number;
  fetched: number;
  stored: number;
  backfilled?: number;
  nightErrors: number;
  /** How many athletes failed outright. */
  failed: number;
  firstFailures?: string[];
  /** Garmin answer shapes that carried no night (garmin/client.ts emptyWellnessShapes). */
  emptyShapes: string[];
}

type Db = { from: (table: string) => any };

export function sweepSummary(
  result: { athletes: number; fetched: number; stored: number; backfilled?: number; nightErrors: number; failed: string[] },
  emptyShapes: string[],
  at: Date = new Date(),
): WellnessSweepSummary {
  return {
    at: at.toISOString(),
    athletes: result.athletes,
    fetched: result.fetched,
    stored: result.stored,
    backfilled: result.backfilled ?? 0,
    nightErrors: result.nightErrors,
    failed: result.failed.length,
    firstFailures: result.failed.slice(0, 3).map((f) => f.slice(0, 160)),
    emptyShapes: emptyShapes.slice(0, 20),
  };
}

/** Best-effort: a failed write must not fail the sweep it describes. */
export async function saveLastSweep(supabase: Db, summary: WellnessSweepSummary): Promise<boolean> {
  try {
    const { error } = await supabase.from('app_settings').upsert(
      { key: WELLNESS_LAST_SWEEP_KEY, value: JSON.stringify(summary), updated_at: summary.at },
      { onConflict: 'key' },
    );
    if (error) console.error('wellness_last_sweep not saved:', error);
    return !error;
  } catch (err) {
    console.error('wellness_last_sweep not saved:', err);
    return false;
  }
}

export function parseLastSweep(value: unknown): WellnessSweepSummary | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const v = JSON.parse(value);
    if (!v || typeof v !== 'object' || typeof v.at !== 'string') return null;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    return {
      at: v.at,
      athletes: n(v.athletes), fetched: n(v.fetched), stored: n(v.stored), backfilled: n(v.backfilled),
      nightErrors: n(v.nightErrors), failed: n(v.failed),
      firstFailures: Array.isArray(v.firstFailures) ? v.firstFailures.map(String).slice(0, 3) : [],
      emptyShapes: Array.isArray(v.emptyShapes) ? v.emptyShapes.map(String).slice(0, 20) : [],
    };
  } catch {
    return null;
  }
}

export async function loadLastSweep(supabase: Db): Promise<WellnessSweepSummary | null> {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', WELLNESS_LAST_SWEEP_KEY).maybeSingle();
    return parseLastSweep((data as { value?: unknown } | null)?.value);
  } catch {
    return null;
  }
}

/** One plain line: when, and the counts. Times in Israel. */
export function lastSweepLine(s: WellnessSweepSummary | null): string {
  if (!s) return 'סריקת שינה ודופק אחרונה: אין רישום עדיין';
  let when = s.at;
  try {
    when = new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(s.at));
  } catch { /* the ISO string */ }
  const shapes = s.emptyShapes.length ? ` · צורות ריקות: ${s.emptyShapes.join(', ')}` : '';
  return `סריקת שינה ודופק אחרונה: ${when} · מתאמנים ${s.athletes} · נמשכו ${s.fetched} · נשמרו ${s.stored} · שגיאות לילה ${s.nightErrors} · נכשלו ${s.failed}${shapes}`;
}
