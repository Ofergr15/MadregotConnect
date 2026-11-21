import type { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { CHANGE_NOTICE_SCOPE } from './constants';

/** Group number 1–3 (resolveGroup index + 1). */
export type GroupNo = 1 | 2 | 3;
export const ALL_GROUPS: GroupNo[] = [1, 2, 3];

export interface PlanChange {
  dayOfWeek: number;
  partIndex: number;
  kind: 'added' | 'removed' | 'changed';
  /** Which groups this change reaches. A structural change reaches all three. */
  groups: GroupNo[];
  name: string;
  /** e.g. "קצב קבוצה 3" / "מבנה" */
  what: string[];
}

const DAY_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const key = (w: ParsedWorkout) => `${w.dayOfWeek}:${w.partIndex ?? 1}`;

function structure(s: WorkoutStep): unknown {
  return [s.type, s.durationType, s.durationValue ?? null, s.durationMaxValue ?? null,
    s.repeatCount ?? null, s.targetType, (s.repeatSteps || []).map(structure)];
}
function g1(s: WorkoutStep): unknown {
  return [s.targetPaceMinPerKm ?? null, s.targetPaceMaxPerKm ?? null, s.targetHrMinPct ?? null,
    s.targetHrMaxPct ?? null, (s.repeatSteps || []).map(g1)];
}
function g2(s: WorkoutStep): unknown { return [s.group2Pace ?? null, s.group2HeartRate ?? null, (s.repeatSteps || []).map(g2)]; }
function g3(s: WorkoutStep): unknown { return [s.group3Pace ?? null, s.group3HeartRate ?? null, (s.repeatSteps || []).map(g3)]; }
function notes(s: WorkoutStep): unknown { return [s.notes ?? '', (s.repeatSteps || []).map(notes)]; }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffPlans(from: ParsedWeeklyPlan, to: ParsedWeeklyPlan): PlanChange[] {
  const a = new Map(from.workouts.map((w) => [key(w), w]));
  const b = new Map(to.workouts.map((w) => [key(w), w]));
  const out: PlanChange[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k), y = b.get(k);
    const ref = (y || x)!;
    const base = { dayOfWeek: ref.dayOfWeek, partIndex: ref.partIndex ?? 1, name: ref.name };
    if (!x) { out.push({ ...base, kind: 'added', groups: ALL_GROUPS, what: ['אימון חדש'] }); continue; }
    if (!y) { out.push({ ...base, kind: 'removed', groups: ALL_GROUPS, what: ['אימון בוטל'] }); continue; }
    const what: string[] = [];
    const groups = new Set<GroupNo>();
    if (!same(x.steps.map(structure), y.steps.map(structure)) || x.name !== y.name) {
      what.push('מבנה'); ALL_GROUPS.forEach((g) => groups.add(g));
    }
    if (!same(x.steps.map(g1), y.steps.map(g1))) { what.push('קצב קבוצה 1'); groups.add(1); }
    if (!same(x.steps.map(g2), y.steps.map(g2))) { what.push('קצב קבוצה 2'); groups.add(2); }
    if (!same(x.steps.map(g3), y.steps.map(g3))) { what.push('קצב קבוצה 3'); groups.add(3); }
    if (!same(x.steps.map(notes), y.steps.map(notes)) || (x.description ?? '') !== (y.description ?? '')) {
      what.push('הערות'); ALL_GROUPS.forEach((g) => groups.add(g));
    }
    if (what.length) out.push({ ...base, kind: 'changed', groups: [...groups].sort() as GroupNo[], what });
  }
  return out.sort((p, q) => p.dayOfWeek - q.dayOfWeek || p.partIndex - q.partIndex);
}

/** Groups a set of changes reaches, honouring CHANGE_NOTICE_SCOPE. */
export function affectedGroups(changes: PlanChange[], scope = CHANGE_NOTICE_SCOPE): GroupNo[] {
  if (!changes.length) return [];
  if (scope === 'everyone') return ALL_GROUPS;
  return [...new Set(changes.flatMap((c) => c.groups))].sort() as GroupNo[];
}

/** The pre-filled, editable change message (BUILD-BRIEF item 6). */
export function changeMessage(changes: PlanChange[]): string {
  if (!changes.length) return '';
  const lines = changes.map((c) => {
    const verb = c.kind === 'added' ? 'נוסף' : c.kind === 'removed' ? 'בוטל' : 'עודכן';
    const detail = c.kind === 'changed' ? ` (${c.what.join(', ')})` : '';
    return `יום ${DAY_HE[c.dayOfWeek]} — ${c.name}: ${verb}${detail}`;
  });
  return `עדכון לתוכנית השבוע:\n${lines.join('\n')}`;
}
