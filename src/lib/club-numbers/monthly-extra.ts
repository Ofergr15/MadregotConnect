/**
 * "מדרגות במספרים" monthly — the sections beyond running volume (design/b22/club-stats):
 * packs, tracks, watch connections, attendance, races & PRs, the quality session, and
 * retention by join month. Pure, like ./monthly: no clock, no database (the loader is ./server).
 *
 * Counts only, everywhere: no names and no ids leave these functions. U21 is a count of forms
 * (they are not linked to a member); attendance is staff data turned into two numbers.
 *
 * Each section is `null` for a month it cannot answer (nothing marked, no plan) rather than 0,
 * so a client never draws a collapse that is really missing data.
 */
import { CLUB_PACKS, packOf } from './compute';

const monthOf = (iso: string) => iso.slice(0, 7);
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface XAthlete {
  id: string;
  createdAt: string;
  /** undefined = removed_at not there (pre-209); null = still in. */
  removedAt?: string | null;
  status: string | null;
  groupName: string | null;
  isAcademy: boolean;
  academyJoinedOn: string | null;
  garmin: boolean;
  strava: boolean;
  garminConnectedAt: string | null;
  stravaConnectedAt: string | null;
}
export interface XInput {
  months: string[];
  /** Already filtered to real members (no admin / Test accounts), as computeMonthlySeries does. */
  athletes: XAthlete[];
  /** Runs in the window, running types only, already filtered like ./monthly. */
  runs: Array<{ athleteId: string; date: string; km: number }>;
  /** athlete_pack_history: from_date onward the athlete was in `groupName`. */
  packHistory: Array<{ athleteId: string; groupName: string | null; fromDate: string }>;
  u21: Array<{ createdAt: string }>;
  /** workout_attendance turned into dates (week_start_date + day_of_week). */
  rsvps: Array<{ athleteId: string; date: string; attending: boolean }>;
  /** practice_presence turned into dates. A date with any row is a day the coach marked. */
  presence: Array<{ athleteId: string; date: string; present: boolean }>;
  /** race_results, every date (PRs need the races before the window). */
  races: Array<{ athleteId: string; distance: string; seconds: number; date: string }>;
  /** Group plan weeks in the window: the quality days, and each workout_key's day. */
  plans: Array<{ weekStart: string; qualityDays: number[]; keyDay: Record<string, number> }>;
  /** activity_plan_matches of those weeks. */
  matches: Array<{ athleteId: string; weekStart: string; workoutKey: string }>;
}

export const MONTHLY_PACKS = [...CLUB_PACKS, 'אקדמיה'] as const;

export function computeMonthlyExtra(x: XInput) {
  const hasRemovedAt = x.athletes.some((a) => a.removedAt !== undefined);
  const memberAt = (a: XAthlete, ym: string) => {
    if (a.createdAt.slice(0, 10) > lastDay(ym)) return false;
    if (hasRemovedAt) return !a.removedAt || a.removedAt.slice(0, 10) >= `${ym}-01`;
    return a.status !== 'removed';
  };

  // Pack at a month's end: the latest history row on or before it, else today's group.
  const hist = new Map<string, Array<{ groupName: string | null; fromDate: string }>>();
  for (const h of [...x.packHistory].sort((a, b) => a.fromDate.localeCompare(b.fromDate))) {
    if (!hist.has(h.athleteId)) hist.set(h.athleteId, []);
    hist.get(h.athleteId)!.push(h);
  }
  const academyAt = (a: XAthlete, ym: string) => a.isAcademy && (a.academyJoinedOn ?? a.createdAt).slice(0, 10) <= lastDay(ym);
  const packAt = (a: XAthlete, ym: string): string => {
    if (academyAt(a, ym)) return 'אקדמיה';
    const rows = hist.get(a.id)?.filter((h) => h.fromDate <= lastDay(ym));
    const groupName = rows?.length ? rows.at(-1)!.groupName : a.groupName;
    return packOf({ isAcademy: false, bandNumber: null, groupName });
  };

  const byId = new Map(x.athletes.map((a) => [a.id, a]));
  const runsBy = new Map<string, typeof x.runs>(x.months.map((m) => [m, []]));
  for (const r of x.runs) runsBy.get(monthOf(r.date))?.push(r);

  // PRs: a race faster than every earlier race of the same athlete at the same distance.
  const prMonths: string[] = [];
  const best = new Map<string, number>();
  for (const r of [...x.races].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${r.athleteId}|${r.distance}`;
    const prev = best.get(k);
    if (prev !== undefined && r.seconds < prev) prMonths.push(monthOf(r.date));
    if (prev === undefined || r.seconds < prev) best.set(k, r.seconds);
  }

  // Attendance: only the dates a coach marked count, so the months before marking began read null.
  const markedDates = new Set(x.presence.map((p) => p.date));
  const presentKey = new Set(x.presence.filter((p) => p.present).map((p) => `${p.athleteId}|${p.date}`));

  // Quality session: per plan week, the share of the members who ran that week who ran a quality day's workout.
  const matchedWeek = new Map<string, Set<string>>();
  const planByWeek = new Map(x.plans.map((p) => [p.weekStart, p]));
  for (const m of x.matches) {
    const p = planByWeek.get(m.weekStart);
    const day = p?.keyDay[m.workoutKey];
    if (p == null || day == null || !p.qualityDays.includes(day)) continue;
    if (!matchedWeek.has(m.weekStart)) matchedWeek.set(m.weekStart, new Set());
    matchedWeek.get(m.weekStart)!.add(m.athleteId);
  }
  const weekShare = (weekStart: string): number | null => {
    const p = planByWeek.get(weekStart);
    if (!p || !p.qualityDays.length) return null;
    const end = addDays(weekStart, 6);
    const ran = new Set(x.runs.filter((r) => r.date >= weekStart && r.date <= end && byId.has(r.athleteId)).map((r) => r.athleteId));
    if (!ran.size) return null;
    const did = [...(matchedWeek.get(weekStart) ?? [])].filter((id) => ran.has(id)).length;
    return did / ran.size;
  };

  const series = x.months.map((ym) => {
    const members = x.athletes.filter((a) => memberAt(a, ym));
    const rs = runsBy.get(ym) ?? [];

    const packs = Object.fromEntries(MONTHLY_PACKS.map((p) => [p, { members: 0, km: 0 }]));
    for (const a of members) packs[packAt(a, ym)].members++;
    for (const r of rs) { const a = byId.get(r.athleteId); if (a) packs[packAt(a, ym)].km += r.km; }
    for (const p of MONTHLY_PACKS) packs[p].km = Math.round(packs[p].km);

    const academy = members.filter((a) => academyAt(a, ym)).length;
    const tracks = { club: members.length - academy, academy, u21: x.u21.filter((u) => monthOf(u.createdAt) === ym).length };

    // Watch at the month's end. A disconnection carries no date, so a member who has since
    // disconnected reads as never connected — the history undercounts, today's figure is exact.
    const end = lastDay(ym);
    const on = (flag: boolean, at: string | null, a: XAthlete) => flag && (at ?? a.createdAt).slice(0, 10) <= end;
    let garmin = 0, stravaOnly = 0;
    for (const a of members) {
      if (on(a.garmin, a.garminConnectedAt, a)) garmin++;
      else if (on(a.strava, a.stravaConnectedAt, a)) stravaOnly++;
    }
    const watch = { garmin, stravaOnly, none: members.length - garmin - stravaOnly };

    const rsvpd = x.rsvps.filter((r) => r.attending && monthOf(r.date) === ym && markedDates.has(r.date));
    const marked = [...markedDates].filter((d) => monthOf(d) === ym);
    const attendance = marked.length
      ? { days: marked.length, rsvp: rsvpd.length, came: rsvpd.filter((r) => presentKey.has(`${r.athleteId}|${r.date}`)).length,
          present: x.presence.filter((p) => p.present && monthOf(p.date) === ym).length }
      : null;

    const races = x.races.filter((r) => monthOf(r.date) === ym).length;
    const prs = prMonths.filter((m) => m === ym).length;

    const shares = x.plans.filter((p) => monthOf(p.weekStart) === ym).map((p) => weekShare(p.weekStart)).filter((v): v is number => v != null);
    const quality = shares.length ? r2(shares.reduce((s, v) => s + v, 0) / shares.length) : null;

    return { month: ym, packs, tracks, watch, attendance, races, prs, quality };
  });

  // Retention by join month: of those who joined in month X, the share who ran in X+0, X+1, …
  const ranIn = new Map<string, Set<string>>(x.months.map((m) => [m, new Set((runsBy.get(m) ?? []).map((r) => r.athleteId))]));
  const cohorts = x.months.map((ym, i) => {
    const joined = x.athletes.filter((a) => monthOf(a.createdAt) === ym);
    const ran = x.months.slice(i).map((m) => (joined.length ? r2(joined.filter((a) => ranIn.get(m)!.has(a.id)).length / joined.length) : null));
    return { month: ym, size: joined.length, ran };
  }).filter((c) => c.size > 0);

  return { packs: [...MONTHLY_PACKS], series, cohorts };
}
export type MonthlyExtra = ReturnType<typeof computeMonthlyExtra>;
