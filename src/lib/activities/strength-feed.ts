/**
 * Strength on the feed — a post-pass over projected items, so FEED_SELECT never names
 * `exercise_sets`. That matters: an embedded select naming a column the database doesn't
 * have fails the WHOLE feed query, and migration 203 is pasted in by hand.
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
import { exerciseCount, isMissingExerciseSetsColumn, type StrengthSet } from './strength';

type Db = ReturnType<typeof createServerClient>;

export interface FeedStrengthSummary { exercises: number; sets: number }

export function summarise(sets: StrengthSet[] | null | undefined): FeedStrengthSummary | null {
  if (!Array.isArray(sets) || !sets.length) return null;
  return { exercises: exerciseCount(sets), sets: sets.length };
}

/** Pure: which items stay, and what each strength card says. */
export function applyStrength(
  items: FeedItem[],
  viewerHasFlag: boolean,
  setsById: Map<string, StrengthSet[] | null>,
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
        strength: summarise(setsById.get(a.id) ?? null),
      },
    });
  }
  return out;
}

export async function strengthForFeed(db: Db, items: FeedItem[], viewerAthleteId: string | null): Promise<FeedItem[]> {
  const ids = items.filter(i => i.activity && isStrengthType(i.activity.activityType)).map(i => i.activity!.id);
  if (!ids.length) return items;
  const viewerHasFlag = await isFeatureEnabled('strength_training', viewerAthleteId, db).catch(() => false);
  const setsById = new Map<string, StrengthSet[] | null>();
  if (viewerHasFlag) {
    const { data, error } = await db.from('athlete_activities').select('id, exercise_sets').in('id', ids);
    if (!error) for (const r of (data || []) as Array<{ id: string; exercise_sets: StrengthSet[] | null }>) setsById.set(r.id, r.exercise_sets);
    else if (!isMissingExerciseSetsColumn(error)) console.error('strength feed sets read failed', error.message);
  }
  return applyStrength(items, viewerHasFlag, setsById);
}
