// Pain reports — the pure half: validation, follow-up cadence, and who hears it.
//
// A pain report is NAMED HEALTH DATA WITH A BODY LOCATION. It reaches the runner's
// own coaches only (decision 2026-11-21): a club runner → the club's coaches; an
// academy trainee → their coaches plus the academy managers. Managers never see a
// club runner's pain. There is no "health contact" role. It is never in the feed,
// never member-visible, never cached by swr-persist.

export const PAIN_AREAS = [
  'foot', 'ankle', 'achilles', 'shin', 'calf', 'knee', 'hamstring', 'quad',
  'hip', 'groin', 'glute', 'lower_back', 'upper_back', 'shoulder', 'other',
] as const;
export type PainArea = (typeof PAIN_AREAS)[number];

export const PAIN_AREA_HE: Record<PainArea, string> = {
  foot: 'כף רגל', ankle: 'קרסול', achilles: 'אכילס', shin: 'שוק', calf: 'תאומים',
  knee: 'ברך', hamstring: 'ירך אחורית', quad: 'ירך קדמית', hip: 'ירך / מפרק ירך',
  groin: 'מפשעה', glute: 'ישבן', lower_back: 'גב תחתון', upper_back: 'גב עליון',
  shoulder: 'כתף', other: 'אחר',
};

export const SIDES = ['left', 'right', 'both'] as const;
export const SINCE = ['today', 'during_run', 'days', 'week_plus'] as const;
export const EFFECTS = ['none', 'altered', 'stopped', 'cannot_run'] as const;
export const TRENDS = ['better', 'same', 'worse', 'gone'] as const;
export type Trend = (typeof TRENDS)[number];
export type PainStatus = 'open' | 'resolved' | 'withdrawn';

export interface PainInput {
  area: PainArea;
  side: (typeof SIDES)[number] | null;
  severity: number;
  since: (typeof SINCE)[number];
  effect: (typeof EFFECTS)[number];
  note: string | null;
  activityId: string | null;
  markInjured: boolean;
}

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

export function parsePainInput(b: Record<string, unknown>): { ok: true; value: PainInput } | { ok: false; field: string } {
  if (!oneOf(PAIN_AREAS, b.area)) return { ok: false, field: 'area' };
  if (b.side != null && !oneOf(SIDES, b.side)) return { ok: false, field: 'side' };
  if (!Number.isInteger(b.severity) || (b.severity as number) < 1 || (b.severity as number) > 10) return { ok: false, field: 'severity' };
  if (!oneOf(SINCE, b.since)) return { ok: false, field: 'since' };
  if (!oneOf(EFFECTS, b.effect)) return { ok: false, field: 'effect' };
  if (b.note != null && (typeof b.note !== 'string' || b.note.length > 1000)) return { ok: false, field: 'note' };
  return {
    ok: true,
    value: {
      area: b.area,
      side: (b.side as PainInput['side']) ?? null,
      severity: b.severity as number,
      since: b.since,
      effect: b.effect,
      note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null,
      activityId: b.activityId != null ? String(b.activityId) : null,
      markInjured: b.markInjured === true,
    },
  };
}

/** Severity ≥ 7 or "can't run" shows the safety line (and the alert is never digested). */
export function isSevere(p: { severity: number; effect: string }): boolean {
  return p.severity >= 7 || p.effect === 'cannot_run';
}

// ── Follow-up cadence ────────────────────────────────────────────────────────
//
// The next day at 09:00 Israel, then every 2 days while the report is open. Never
// more than one question a day (per runner — the caller dedupes across reports).
// Stop at "gone", when staff close it, or when the runner withdraws. After 14 days
// stop asking the runner and ask the coach instead, once.

export const FOLLOWUP_HOUR = 9;
export const FOLLOWUP_EVERY_DAYS = 2;
export const FOLLOWUP_STOP_DAYS = 14;

export interface FollowupFacts {
  status: PainStatus;
  /** Israel calendar date the report was filed. */
  createdOn: string;
  /** Israel calendar date of the last follow-up question, if any. */
  lastAskedOn: string | null;
  lastTrend: Trend | null;
  escalated: boolean;
}

export type FollowupAction = 'ask' | 'escalate' | null;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);
}

export function followupDue(f: FollowupFacts, today: string, israelHour: number): FollowupAction {
  if (f.status !== 'open' || f.lastTrend === 'gone') return null;
  if (israelHour !== FOLLOWUP_HOUR) return null;
  const age = daysBetween(f.createdOn, today);
  if (age < 1) return null;
  if (age > FOLLOWUP_STOP_DAYS) return f.escalated ? null : 'escalate';
  if (f.lastAskedOn === today) return null;
  if (!f.lastAskedOn) return 'ask';
  return daysBetween(f.lastAskedOn, today) >= FOLLOWUP_EVERY_DAYS ? 'ask' : null;
}

/** At most one question a day per runner: the oldest open report asks. */
export function pickOneFollowupPerRunner<T extends { athleteId: string; createdAt: string }>(due: T[]): T[] {
  const byRunner = new Map<string, T>();
  for (const d of [...due].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!byRunner.has(d.athleteId)) byRunner.set(d.athleteId, d);
  }
  return [...byRunner.values()];
}

// ── Recipients ───────────────────────────────────────────────────────────────

export interface PainRecipientFacts {
  runnerId: string;
  isAcademy: boolean;
  /** Academy trainee: their linked coaches. */
  academyCoaches: string[];
  /** Academy managers + super users (thread-server's definition). */
  managers: string[];
  /** Club runner: the club's active coaches (fixtures already removed). */
  clubCoaches: string[];
  /** Every candidate's roles (primary + extra), for the routing intersection. */
  rolesOf: Record<string, string[]>;
  /** `recipientsForKind('pain_report')` as ROLES: null = not configured, [] = nobody. */
  routedRoles: string[] | null;
}

const STAFFISH = new Set(['admin', 'coach', 'academy_coach', 'academy_manager']);

/**
 * Who a pain report reaches. The coach scope comes first and routing can only
 * NARROW it, never widen it: a routing row can't send a club runner's pain to the
 * academy managers, and nothing here ever resolves a plain `runner`.
 */
export function resolvePainRecipients(f: PainRecipientFacts): string[] {
  const base = f.isAcademy ? [...f.academyCoaches, ...f.managers] : [...f.clubCoaches];
  const managerSet = new Set(f.managers);
  const out: string[] = [];
  for (const id of base) {
    if (!id || id === f.runnerId || out.includes(id)) continue;
    const roles = f.rolesOf[id] ?? [];
    const isManager = f.isAcademy && managerSet.has(id);
    if (!isManager && !roles.some((r) => STAFFISH.has(r))) continue;
    if (f.routedRoles && !isManager && !roles.some((r) => f.routedRoles!.includes(r))) continue;
    if (f.routedRoles && f.routedRoles.length === 0) continue;
    out.push(id);
  }
  return out;
}

/** May this staff caller read/answer this runner's pain? Same scope as the alert. */
export function staffMaySeePain(
  caller: { athleteId: string | null; isSuperUser: boolean; roles: string[] },
  runner: { isAcademy: boolean; academyCoachIds: string[] },
): boolean {
  if (caller.isSuperUser || caller.roles.includes('admin')) return true;
  if (runner.isAcademy) {
    return caller.roles.includes('academy_manager') || (!!caller.athleteId && runner.academyCoachIds.includes(caller.athleteId));
  }
  return caller.roles.includes('coach');
}
