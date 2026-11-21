import type { createServerClient } from '@/lib/supabase/server';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { getActivityWeekStart, activityLocalDateStr } from '@/lib/utils';
import { isHalfOrFull, parseDistanceM, type PaceGroup } from './pace-groups';
import { isMissingSchema, type EventBlock } from './lifecycle';

type Db = ReturnType<typeof createServerClient>;

export interface RunnerData {
  latestResult: { distanceM: number; timeSec: number; date: string } | null;
  avgWeeklyKm8w: number | null;
}

/**
 * The runner's own data for the suggestion:
 *  - latest result = their most recent run in the last 18 months whose distance reads
 *    as a half or full marathon (GPS slack, see `isHalfOrFull`);
 *  - 8-week average = the 8 COMPLETED activity weeks (Monday anchor, the
 *    fetchWeeklyVolume source the coach volume screen uses) before this one, rest
 *    weeks counted as 0.
 */
export async function loadRunnerData(supabase: Db, athleteIds: string[], now = new Date()): Promise<Map<string, RunnerData>> {
  const out = new Map<string, RunnerData>();
  for (const id of athleteIds) out.set(id, { latestResult: null, avgWeeklyKm8w: null });
  if (athleteIds.length === 0) return out;

  const since = new Date(now);
  since.setMonth(since.getMonth() - 18);
  const { data } = await supabase
    .from('athlete_activities')
    .select('athlete_id, start_time, distance, duration, activity_type')
    .in('athlete_id', athleteIds)
    .gte('distance', 20900)
    .gte('start_time', since.toISOString())
    .order('start_time', { ascending: false })
    .limit(500);
  for (const r of (data ?? []) as Array<{ athlete_id: string; start_time: string; distance: number; duration: number | null }>) {
    const cur = out.get(r.athlete_id);
    if (!cur || cur.latestResult || !r.duration || !isHalfOrFull(r.distance)) continue;
    // Snap to the official distance: Riegel is applied to what the race was, not the GPS.
    const distanceM = r.distance < 30000 ? 21097.5 : 42195;
    cur.latestResult = { distanceM, timeSec: r.duration, date: activityLocalDateStr(r.start_time) };
  }

  const current = getActivityWeekStart(now);
  const { byAthlete } = await fetchWeeklyVolume(supabase, { athleteIds, weeks: 9, currentWeekStart: current });
  for (const [id, buckets] of byAthlete) {
    const done = buckets.slice(0, 8);
    const cur = out.get(id);
    if (cur) cur.avgWeeklyKm8w = Math.round((done.reduce((s, b) => s + b.meters, 0) / 8 / 1000) * 10) / 10;
  }
  return out;
}

export async function loadPaceGroups(supabase: Db, eventId: string): Promise<PaceGroup[] | null> {
  const { data, error } = await supabase
    .from('event_pace_groups')
    .select('id, label, target_pace_sec_per_km, position')
    .eq('event_id', eventId)
    .order('position');
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return (data ?? []).map((g: { id: string; label: string; target_pace_sec_per_km: number }) => ({
    id: g.id, label: g.label, targetPaceSecPerKm: g.target_pace_sec_per_km,
  }));
}

/** Event distance: the countdown block's `distanceM`, else the event's first distance chip. */
export function eventDistanceM(event: { distances?: string[] | null }, blocks: EventBlock[]): number | null {
  const cd = blocks.find((b) => b.kind === 'countdown_distance_goal');
  const fromBlock = Number(cd?.config?.distanceM);
  if (Number.isFinite(fromBlock) && fromBlock > 0) return fromBlock;
  return parseDistanceM(event.distances?.[0]);
}

export interface GoalOption { id: string; label: string; minSec: number; maxSec: number }

/** The questionnaire's goal-band question options, from the questionnaire block config. */
export function goalOptions(blocks: EventBlock[]): { questionId: string; options: GoalOption[] } | null {
  const q = blocks.find((b) => b.kind === 'questionnaire');
  const qs = (q?.config?.questions ?? []) as Array<{ id: string; type?: string; options?: GoalOption[] }>;
  const goal = qs.find((x) => x.type === 'goal_band');
  return goal ? { questionId: goal.id, options: goal.options ?? [] } : null;
}

export function chosenBand(blocks: EventBlock[], answers: Record<string, unknown> | null | undefined) {
  const g = goalOptions(blocks);
  if (!g || !answers) return null;
  const opt = g.options.find((o) => o.id === answers[g.questionId]);
  return opt ? { minSec: opt.minSec, maxSec: opt.maxSec, label: opt.label } : null;
}
