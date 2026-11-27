/**
 * Strength on the feed — a post-pass over projected items, so FEED_SELECT never names
 * `exercise_sets`. That matters: an embedded select naming a column the database doesn't
 * have fails the WHOLE feed query, and migration 210 is pasted in by hand.
 *
 * Two rules:
 *  - A viewer without `strength_training` never sees a strength card (old clients would draw
 *    it as a 0 km run). The rows exist only for athletes whose flag is on, but a teammate's
 *    viewer may still be off.
 *  - The card carries COUNTS only — exercises and sets. Weights never leave the server on the
 *    feed; the set-by-set detail is GET /api/activities/strength (self-or-staff).
 */
import type { createServerClient } from '@/lib/supabase/server';
import type { FeedItem } from '@/lib/feed/project';
import { isFeatureEnabled } from '@/lib/features/server';
import { isStrengthType } from './kinds';
import { activeSets, exerciseCount, isMissingExerciseSetsColumn, type StrengthSet } from './strength';

type Db = ReturnType<typeof createServerClient>;

export interface FeedStrengthSummary {
  exercises: number;
  sets: number;
  /** Garmin aerobic Training Effect (0-5). HR-derived, so null when the athlete hid heart rate. */
  aerobicTe?: number | null;
  /** Strava Relative Effort. HR-derived, same rule. */
  relativeEffort?: number | null;
}

export interface StrengthExtras { te: number | null; sufferScore: number | null }

export function summarise(sets: StrengthSet[] | null | undefined): FeedStrengthSummary | null {
  const act = activeSets(Array.isArray(sets) ? sets : null);
  if (!act.length) return null;
  return { exercises: exerciseCount(act), sets: act.length };
}

function withExtras(base: FeedStrengthSummary | null, x: StrengthExtras | undefined, hrHidden: boolean): FeedStrengthSummary | null {
  if (!x || hrHidden || (x.te == null && x.sufferScore == null)) return base;
  return { ...(base ?? { exercises: 0, sets: 0 }), aerobicTe: x.te, relativeEffort: x.sufferScore };
}

/** Pure: which items stay, and what each strength card says. */
export function applyStrength(
  items: FeedItem[],
  viewerHasFlag: boolean,
  setsById: Map<string, StrengthSet[] | null>,
  extrasById: Map<string, StrengthExtras> = new Map(),
): FeedItem[] {
  const out: FeedItem[] = [];
  for (const it of items) {
    const a = it.activity;
    if (!a || !isStrengthType(a.activityType)) { out.push(it); continue; }
    if (!viewerHasFlag) continue;
    out.push({
      ...it,
      activity: {
        ...a,
        distance: 0, averagePace: null, routePreview: null, routeHd: false, hasRoute: false,
        paceBands: null, lapBands: null, stepBands: null, planVerdict: null,
        // averageHr arrives null when the athlete hid heart rate (project.ts maskHiddenStats) — TE / Relative Effort follow it.
        strength: withExtras(summarise(setsById.get(a.id) ?? null), extrasById.get(a.id), a.averageHr == null),
      },
    });
  }
  return out;
}

type StrengthRow = {
  id: string;
  training_effect?: { aerobic?: number | null } | null;
  suffer_score?: number | null;
  exercise_sets?: StrengthSet[] | null;
};

export async function strengthForFeed(db: Db, items: FeedItem[], viewerAthleteId: string | null): Promise<FeedItem[]> {
  const ids = items.filter(i => i.activity && isStrengthType(i.activity.activityType)).map(i => i.activity!.id);
  if (!ids.length) return items;
  const viewerHasFlag = await isFeatureEnabled('strength_training', viewerAthleteId, db).catch(() => false);
  const setsById = new Map<string, StrengthSet[] | null>();
  const extrasById = new Map<string, StrengthExtras>();
  if (viewerHasFlag) {
    // One read in the normal case. Each column came from its own migration (pasted by hand), so
    // when the combined select fails on a missing column, fall back to one read per column —
    // in parallel — and let only the missing one come back empty.
    const combined = await db.from('athlete_activities').select('id, training_effect, suffer_score, exercise_sets').in('id', ids);
    let teRows: StrengthRow[] | null = null;
    let ssRows: StrengthRow[] | null = null;
    let setRows: StrengthRow[] | null = null;
    let setsError: { message: string; code?: string } | null = null;
    if (!combined.error) {
      teRows = ssRows = setRows = (combined.data || []) as StrengthRow[];
    } else {
      const [te, ss, sets] = await Promise.all([
        db.from('athlete_activities').select('id, training_effect').in('id', ids),
        db.from('athlete_activities').select('id, suffer_score').in('id', ids),
        db.from('athlete_activities').select('id, exercise_sets').in('id', ids),
      ]);
      teRows = (te.data || []) as StrengthRow[];
      ssRows = (ss.data || []) as StrengthRow[];
      setRows = sets.error ? null : (sets.data || []) as StrengthRow[];
      setsError = sets.error;
    }
    for (const r of teRows) extrasById.set(r.id, { te: r.training_effect?.aerobic ?? null, sufferScore: null });
    for (const r of ssRows) {
      const cur = extrasById.get(r.id) ?? { te: null, sufferScore: null };
      extrasById.set(r.id, { ...cur, sufferScore: r.suffer_score ?? null });
    }
    if (setRows) for (const r of setRows) setsById.set(r.id, r.exercise_sets ?? null);
    else if (setsError && !isMissingExerciseSetsColumn(setsError)) console.error('strength feed sets read failed', setsError.message);
  }
  return applyStrength(items, viewerHasFlag, setsById, extrasById);
}
