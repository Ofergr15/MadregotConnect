import type { AcademyMember } from './members';
import type { FunnelBoard } from './funnel';

// The numbers behind the manager's home screen, kept out of the component so they
// can be tested without rendering it. Everything here is derived from payloads the
// academy page already fetches — the members directory and the joining board — so
// the home screen cannot disagree with the tabs it links to.

/** 'YYYY-MM-DD' in Israel, which is the calendar the academy's dates are written in. */
export function israelDay(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * Academy size at the end of each of the last `weeks` weeks, oldest first, ending
 * with the week that starts `weekStart`.
 *
 * Built from join dates alone, so somebody who has since left is not in it — the
 * line is "how today's academy was built up", not a historical headcount, which
 * nothing records. A member with no join date predates the column and is counted
 * from the start.
 */
export function memberTrend(members: AcademyMember[], weekStart: string, weeks = 12): number[] {
  const out: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = addDays(weekStart, 6 - 7 * i);
    out.push(members.filter(m => !m.academyJoinedOn || m.academyJoinedOn <= weekEnd).length);
  }
  return out;
}

/** How many joined in the calendar month `offset` months from today's (0 = this month). */
export function joinedInMonth(members: AcademyMember[], today: string, offset = 0): number {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const prefix = d.toISOString().slice(0, 7);
  return members.filter(x => x.academyJoinedOn?.startsWith(prefix)).length;
}

export interface NewJoiner {
  member: AcademyMember;
  daysAgo: number;
}

/** Joined within `withinDays`, most recent first. */
export function newJoiners(members: AcademyMember[], today: string, withinDays = 45): NewJoiner[] {
  return members
    .filter(m => m.academyJoinedOn && m.academyJoinedOn <= today)
    .map(m => ({ member: m, daysAgo: daysBetween(m.academyJoinedOn!, today) }))
    .filter(j => j.daysAgo <= withinDays)
    .sort((a, b) => a.daysAgo - b.daysAgo || a.member.name.localeCompare(b.member.name));
}

/** "היום", "אתמול", "לפני 5 ימים", "לפני 3 ש׳". */
export function agoLabel(days: number): string {
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 14) return `לפני ${days} ימים`;
  return `לפני ${Math.floor(days / 7)} ש׳`;
}

/** One word per stage, for a bar label ~34px wide. The long wording lives in STAGES. */
export const STAGE_SHORT: Record<string, string> = {
  form: 'טופס',
  intro_call: 'היכרות',
  characterization: 'אפיון',
  signup: 'הרשמה',
  test: 'טסט',
  analysis: 'ניתוח',
  first_plan: 'תוכנית',
  whatsapp: 'וואטסאפ',
  standing_order: 'הו״ק',
};

export interface StageBar {
  key: string;
  label: string;
  count: number;
  /** Anybody in this column past the stage's threshold. */
  stuck: boolean;
}

export function stageBars(board: FunnelBoard): StageBar[] {
  return board.columns.map(c => ({
    key: c.spec.key,
    label: STAGE_SHORT[c.spec.key] ?? c.spec.key,
    count: c.candidates.length,
    stuck: c.candidates.some(x => x.stuck),
  }));
}
