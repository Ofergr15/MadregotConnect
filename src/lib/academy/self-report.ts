/**
 * The trainee's own report on a workout (RPE 1–10 + effort tag + pain + note) — distinct from
 * `academy_workout_feedback`, which is the coach's. Table: academy_trainee_reports (188).
 */
import { EFFORT_LABELS, type EffortTag } from './feedback';

/** Same vocabulary as the coach's (קל / מתאים / קשה / קשה מדי). */
export const EFFORT_VALUES = Object.keys(EFFORT_LABELS) as EffortTag[];
export type Effort = EffortTag;

export const PAIN_AREAS = ['foot', 'ankle', 'shin', 'calf', 'knee', 'thigh', 'hip', 'back', 'other'] as const;
export const NOTE_MAX = 600;

export interface SelfReport {
  workoutDate: string;
  activityId: string | null;
  rpe: number;
  effort: Effort | null;
  pain: boolean;
  painArea: string | null;
  painLevel: number | null;
  note: string;
}

export type ParseResult = { ok: true; report: SelfReport } | { ok: false; error: string };

/** Validate a body into a report. Identity is never read from the body — the route supplies it. */
export function parseSelfReport(body: any): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body required' };
  const date = String(body.workoutDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'workoutDate must be YYYY-MM-DD' };
  const rpe = Number(body.rpe);
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) return { ok: false, error: 'rpe must be 1-10' };
  const effort = body.effort == null ? null : String(body.effort);
  if (effort != null && !(EFFORT_VALUES as readonly string[]).includes(effort)) return { ok: false, error: 'unknown effort' };
  const pain = body.pain === true;
  const painArea = pain && body.painArea ? String(body.painArea) : null;
  if (painArea && !(PAIN_AREAS as readonly string[]).includes(painArea)) return { ok: false, error: 'unknown painArea' };
  const painLevel = pain && body.painLevel != null ? Number(body.painLevel) : null;
  if (painLevel != null && (!Number.isInteger(painLevel) || painLevel < 1 || painLevel > 10)) return { ok: false, error: 'painLevel must be 1-10' };
  const note = String(body.note || '').trim().slice(0, NOTE_MAX);
  const activityId = typeof body.activityId === 'string' && body.activityId ? body.activityId : null;
  return { ok: true, report: { workoutDate: date, activityId, rpe, effort: effort as Effort | null, pain, painArea, painLevel, note } };
}

/** A report with pain, or RPE ≥ 9 on a day the plan called easy, goes to the coach's flag list. */
export function reportNeedsCoach(r: Pick<SelfReport, 'pain' | 'rpe' | 'effort'>): boolean {
  return r.pain || r.effort === 'too_hard' || r.rpe >= 9;
}
