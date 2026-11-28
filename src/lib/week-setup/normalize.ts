import { normalizeOwners, readiness } from './model';
import type { Step } from './log';
import type { WeekSnapshot } from './server';

/**
 * The "תחילת שבוע" screen read every field of /api/week-setup straight off the body, so a
 * partial or empty answer (`{}` — a proxy error page, a deploy mid-swap, the a11y run's
 * generic fixture) threw on the first `data.staff.find` and showed the crash screen.
 * Every missing array/object gets its empty value here, so the screen renders an empty
 * week instead. A full answer passes through unchanged.
 */

export type WeekMe = { id: string | null; admin: boolean; coach: boolean; approver: boolean };
export type WeekData = WeekSnapshot & { me: WeekMe; mine: Step[] };

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T extends object>(v: unknown, fallback: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback);

export function normalizeWeekData(raw: unknown, week: string): WeekData {
  const d = obj<Partial<WeekData>>(raw, {});
  const me = obj<Partial<WeekMe>>(d.me, {});
  const plan = obj<Partial<WeekSnapshot['plan']>>(d.plan, {});
  const pdf = obj<Partial<WeekSnapshot['pdf']>>(d.pdf, {});
  // No readiness at all: the week as if nothing were done yet (the real model's answer, so total > 0).
  const empty = readiness({ planStatus: 'none', nutrition: false, qualityPicked: false, toApprove: 0, polls: false, message: false });
  const r = obj<Partial<WeekSnapshot['readiness']>>(d.readiness, empty);
  return {
    ...d,
    weekStart: typeof d.weekStart === 'string' ? d.weekStart : week,
    plan: { status: plan.status ?? 'none', createdAt: plan.createdAt ?? null },
    pdf: { training: pdf.training ?? null, nutrition: pdf.nutrition ?? null },
    weekNumber: typeof d.weekNumber === 'number' ? d.weekNumber : 0,
    days: arr<WeekSnapshot['days'][number]>(d.days).map((day) => ({ ...day, sessions: arr(day?.sessions) })),
    teamDays: arr(d.teamDays),
    workoutHour: typeof d.workoutHour === 'number' ? d.workoutHour : 5,
    qualityDays: arr(d.qualityDays),
    qualityPicked: !!d.qualityPicked,
    folders: obj(d.folders, {}),
    timeline: arr(d.timeline),
    approvalMode: typeof d.approvalMode === 'string' ? d.approvalMode : '',
    polls: arr(d.polls),
    owners: normalizeOwners(d.owners),
    staff: arr(d.staff),
    readiness: {
      done: typeof r.done === 'number' ? r.done : 0,
      total: typeof r.total === 'number' && r.total > 0 ? r.total : empty.total,
      missing: arr(r.missing),
      next: r.next ?? null,
    },
    log: arr(d.log),
    watches: d.watches && typeof d.watches === 'object' ? { ...d.watches, failed: arr(d.watches.failed) } : null,
    plannedPolls: arr(d.plannedPolls),
    groups: arr(d.groups),
    me: { id: me.id ?? null, admin: !!me.admin, coach: !!me.coach, approver: !!me.approver },
    mine: arr(d.mine),
  };
}
