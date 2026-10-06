// Which days of a plan week are quality days — the pure half. Detection reads
// the plan (lib/quality-session/server qualityWorkout); the super user can pick
// the week's days by hand on the plan screen, and a picked week is decided by
// the pick alone. The pick is the club's: app_settings, keyed by the plan week's
// Sunday, so no migration and the parsed plan itself is never rewritten.

import type { ParsedWorkout } from '@/lib/ai/types';
import { classifyWorkout } from '@/lib/plans/session-summary';
import { isOptionalWorkout } from '@/lib/plans/normalize-plan';
import { QUALITY_TYPES } from './model';

export const PLAN_DAYS_KEY = 'quality_plan_days';

/** Plan-week Sunday → the days (0 = Sunday) picked as quality days. */
export type PlanDays = Record<string, number[]>;

export function parsePlanDays(raw: string | null | undefined): PlanDays {
  try {
    const v = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: PlanDays = {};
    for (const [week, days] of Object.entries(v)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Array.isArray(days)) continue;
      out[week] = [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    }
    return out;
  } catch {
    return {};
  }
}

export interface WeekQuality {
  /** What the plan alone says: a morning intervals / tempo / fartlek that is not optional. */
  auto: number[];
  /** Not detected, but it looks like one: a morning with a set in it that was saved optional or untyped. */
  suggested: number[];
  /** The days that count: the pick when there is one, otherwise `auto`. */
  days: number[];
  manual: boolean;
}

const morning = (w: ParsedWorkout) => w.partKind !== 'evening';
const isQuality = (w: ParsedWorkout) => QUALITY_TYPES.includes(classifyWorkout(w));
const hasSet = (w: ParsedWorkout) =>
  (w.steps || []).some(s => (s.repeatCount ?? 0) > 1 && (s.type === 'interval' || (s.repeatSteps || []).some(x => x.type === 'interval')));

export function weekQuality(lists: ParsedWorkout[][], picked: number[] | undefined): WeekQuality {
  const auto: number[] = [], suggested: number[] = [];
  for (let dow = 0; dow <= 6; dow++) {
    const day = lists.flatMap(ws => ws.filter(w => w.dayOfWeek === dow && morning(w)));
    if (day.some(w => !isOptionalWorkout(w) && isQuality(w))) auto.push(dow);
    else if (day.some(w => isQuality(w) || hasSet(w))) suggested.push(dow);
  }
  return { auto, suggested, days: picked ?? auto, manual: picked !== undefined };
}
