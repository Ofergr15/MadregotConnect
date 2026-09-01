// The academy screens' presentation layer: badge colours, formatters, and a
// re-export of the payload types.
//
// The types and ATTENTION_ORDER come from @/lib/academy/members, which the route
// also uses — one definition, so a field added to the payload can't silently go
// missing from the components. That module deliberately imports no Supabase
// client, so pulling it into a 'use client' graph costs nothing (the pattern the
// other academy components avoid is importing a *route* module, which does drag
// `createServerClient` along).

export { ATTENTION_ORDER } from '@/lib/academy/members';
export type {
  AttentionReason,
  AcademyMember,
  AcademyGroupSummary,
  AcademyTeamTotals,
  AcademyMembersResponse,
} from '@/lib/academy/members';

import type { AttentionReason } from '@/lib/academy/members';

export const ATTENTION_STYLE: Record<AttentionReason, string> = {
  not_approved: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  no_watch: 'bg-red-500/15 text-red-300 border-red-500/25',
  inactive: 'bg-red-500/15 text-red-300 border-red-500/25',
  low_adherence: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  no_runs: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  no_plan: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
};

// ── Formatting ───────────────────────────────────────────────────────────────

/** Minutes → "1 ש' 20 ד'" style, matching AcademyStats' existing formatter. */
export function fmtDuration(min: number, hourLabel: string, minuteLabel: string): string {
  if (min < 60) return `${min} ${minuteLabel}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ${hourLabel} ${m} ${minuteLabel}` : `${h} ${hourLabel}`;
}

export function initialsOf(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

/**
 * A completion rate as a percent string, or an em dash when nothing was planned.
 * `null` and `0` mean genuinely different things here — "we never gave them a
 * plan" is a coaching gap, "they did none of their plan" is an athlete problem —
 * so they must never render the same.
 */
export function fmtRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function rateColor(rate: number | null): string {
  if (rate === null) return 'text-slate-500';
  if (rate >= 0.8) return 'text-emerald-400';
  if (rate >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

/** Sunday-of, as a YYYY-MM-DD string, from a real Date. */
export function sundayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}

export function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}

export function fmtWeekRange(weekStart: string, locale: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`;
}
