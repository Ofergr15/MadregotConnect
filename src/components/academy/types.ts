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
  AcademyCoachSummary,
  AcademyCoachRef,
  AcademyTeamTotals,
  AcademyMembersResponse,
} from '@/lib/academy/members';
export type { AcademyBand, BandPaceProfile } from '@/lib/academy/bands';

import type { AttentionReason } from '@/lib/academy/members';
import { planWeekStartOf, shiftWeekStart } from '@/lib/utils';

// Badge = a tint of the reason's colour behind that same colour's text, which is
// how the light system does status chips on a white card (the old dark palette
// needed a *lighter* text than its fill — hence the previous 500/15 + 300 pairs).
// The designer's palette has one warning colour (band 3), so the near-identical
// amber and orange reasons now share it; the badge's own text names the reason,
// so nothing is lost by the two hues collapsing.
export const ATTENTION_STYLE: Record<AttentionReason, string> = {
  not_approved: 'bg-band-3/10 text-band-3-ink border-band-3/25',
  // Read as a gap in the academy's own setup rather than a fault of the athlete,
  // so it wears the accent colour the pairing UI uses, not a warning colour.
  no_coach: 'bg-band-2/10 text-band-2-ink border-band-2/25',
  // Same reading, same colour: a missing goal band is the academy's own setup gap,
  // and it blocks the planner exactly the way a missing coach does.
  no_band: 'bg-band-2/10 text-band-2-ink border-band-2/25',
  no_watch: 'bg-accent-red/10 text-accent-red-ink border-accent-red/25',
  inactive: 'bg-accent-red/10 text-accent-red-ink border-accent-red/25',
  low_adherence: 'bg-band-3/10 text-band-3-ink border-band-3/25',
  no_runs: 'bg-band-3/10 text-band-3-ink border-band-3/25',
  // No plan is an absence, not a problem with a severity — neutral ink.
  no_plan: 'bg-ink-300/15 text-ink-500 border-ink-300/40',
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
  if (rate === null) return 'text-ink-400';
  if (rate >= 0.8) return 'text-accent-600';
  if (rate >= 0.5) return 'text-band-3';
  return 'text-accent-red';
}

/**
 * Sunday-of, as a YYYY-MM-DD string, from a real Date.
 *
 * Both of these used to be hand-rolled here on `getUTCDay()`, which answers for
 * the UTC calendar date — still yesterday between 00:00 and 03:00 in Israel, and
 * a whole week off when that yesterday was a Saturday. They now delegate to the
 * shared, DST-aware helpers; the names stay because five components import them.
 */
export function sundayOf(date: Date): string {
  return planWeekStartOf(date);
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return shiftWeekStart(weekStart, weeks);
}

export function fmtWeekRange(weekStart: string, locale: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`;
}
