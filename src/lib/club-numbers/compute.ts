/**
 * "מדרגות במספרים" — the club's numbers in one place (mockup
 * ~/.cache/madregot/club-numbers-v3.html, Ofer 2026-10-20). Everything here is arithmetic on
 * rows the server already holds; no clock and no database, so it can be tested. `today` is the
 * Israel date.
 *
 * Conventions:
 *  - Weeks run Sunday → Saturday, the club's own week.
 *  - An activity's `start_time` is the runner's local wall clock stored as if it were UTC
 *    (see lib/utils activityLocalDateStr), so its date and hour are read off the string.
 *  - A "member" is an active, non-admin account that ran in the last 8 weeks. Academy
 *    trainees are members too, counted apart.
 */

export const RUN_TYPES = new Set(['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run', 'indoor_running']);
const TEAM_DAYS_DEFAULT = [2, 5];
/** The steps a trainee takes into the app, in order (the standing order is not one of them). */
export const ENTRY_STEPS = ['inApp', 'watch', 'test', 'form', 'plan'] as const;
export type EntryStep = (typeof ENTRY_STEPS)[number];
/** The intake funnel's stages as the board shows them (lib/academy/funnel), minus the standing order. */
export const FUNNEL_STAGES = ['contact', 'form', 'intro_call', 'characterization', 'test', 'first_plan'] as const;

export interface NAthlete {
  id: string; name: string; status: string | null; role: string | null; isSuper?: boolean;
  isAcademy: boolean; bandNumber: number | null; academyJoinedOn: string | null;
  groupName: string | null; createdAt: string; firstSeenAt: string | null; lastSeenAt: string | null;
  approved: boolean; watch: boolean; birthDate: string | null; gender: string | null;
}
export interface NRun { athleteId: string; start: string; meters: number; seconds: number; type: string }
export interface NCandidate { id: string; name: string; source: string | null; createdAt: string; athleteId: string | null; stages: string[] }
export interface NInput {
  today: string;
  athletes: NAthlete[];
  runs: NRun[];
  candidates: NCandidate[];
  /** Trainee ids with an approved 30-minute test, with an answered characterization form, with a personal week. */
  tested: Set<string>; formed: Set<string>; planned: Set<string>;
  teamDays?: number[];
  coreOverride?: { add: string[]; remove: string[] };
}

// ── dates ──────────────────────────────────────────────────────────────────────────

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const sundayOf = (iso: string) => addDays(iso, -new Date(`${iso}T12:00:00Z`).getUTCDay());
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const localDate = (start: string) => start.slice(0, 10);
const localHour = (start: string) => Number(start.slice(11, 13));
const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The pack a member trains with: "דבוקה 1–3" for the club, the band for a trainee. */
export function packOf(a: Pick<NAthlete, 'isAcademy' | 'bandNumber' | 'groupName'>): string {
  if (a.isAcademy) return a.bandNumber ? `דבוקה ${a.bandNumber}` : 'אקדמיה';
  const n = (a.groupName || '').toLowerCase();
  if (n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30')) return 'דבוקה 1';
  if (n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35')) return 'דבוקה 2';
  if (n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45')) return 'דבוקה 3';
  return 'בלי דבוקה';
}
export const CLUB_PACKS = ['דבוקה 1', 'דבוקה 2', 'דבוקה 3', 'בלי דבוקה'] as const;

/** Load: the last 7 days against the 4-week weekly average. */
export function loadState(last7: number, weekly28: number): { ratio: number | null; state: 'normal' | 'spike' | 'drop' | 'none' } {
  if (weekly28 <= 0) return { ratio: null, state: 'none' };
  const ratio = Math.round((last7 / weekly28) * 100) / 100;
  return { ratio, state: ratio > 1.3 ? 'spike' : ratio < 0.8 ? 'drop' : 'normal' };
}

// ── the whole thing ────────────────────────────────────────────────────────────────

export function computeClubNumbers(x: NInput) {
  const today = x.today;
  const thisWeek = sundayOf(today);
  const dayIdx = daysBetween(thisWeek, today);
  const teamDays = x.teamDays?.length ? x.teamDays : TEAM_DAYS_DEFAULT;
  const people = x.athletes.filter((a) => !/^test /i.test(a.name) && a.role !== 'admin');
  const byId = new Map(people.map((a) => [a.id, a]));
  const runs = x.runs.filter((r) => byId.has(r.athleteId) && RUN_TYPES.has(r.type) && r.meters > 0)
    .map((r) => ({ ...r, date: localDate(r.start), km: r.meters / 1000 }));
  const runsBy = new Map<string, typeof runs>();
  for (const r of runs) (runsBy.get(r.athleteId) ?? runsBy.set(r.athleteId, []).get(r.athleteId)!).push(r);
  const kmIn = (id: string, from: string, to: string) => (runsBy.get(id) ?? []).reduce((s, r) => (r.date >= from && r.date <= to ? s + r.km : s), 0);
  const countIn = (id: string, from: string, to: string) => (runsBy.get(id) ?? []).filter((r) => r.date >= from && r.date <= to).length;

  const active = people.filter((a) => a.status === 'active');
  const members = active.filter((a) => countIn(a.id, addDays(thisWeek, -56), today) > 0);
  const club = members.filter((a) => !a.isAcademy);
  const trainees = active.filter((a) => a.isAcademy);
  const createdOn = (a: NAthlete) => a.createdAt.slice(0, 10);
  const launchDate = people.reduce((m, a) => (createdOn(a) < m ? createdOn(a) : m), today);
  const launch = sundayOf(launchDate);
  const weeks: string[] = [];
  for (let w = launch; w <= thisWeek; w = addDays(w, 7)) weeks.push(w);
  const fullWeeks = weeks.slice(0, -1);
  const monthAgo = addDays(today, -30);

  // ── the club section of the overview
  const weekKm = (w: string, ids: NAthlete[]) => ids.reduce((s, a) => s + kmIn(a.id, w, addDays(w, 6)), 0);
  const weeklyKm = fullWeeks.map((w) => ({ week: w, km: Math.round(weekKm(w, members)) }));
  const soFar = Math.round(members.reduce((s, a) => s + kmIn(a.id, thisWeek, today), 0));
  const lastWeek = addDays(thisWeek, -7);
  const lastSame = Math.round(members.reduce((s, a) => s + kmIn(a.id, lastWeek, addDays(lastWeek, dayIdx)), 0));
  const lastFull = weeklyKm.at(-1)?.km ?? 0;
  const accounts = weeks.map((w) => people.filter((a) => createdOn(a) <= addDays(w, 6)).length);
  const runnersThisWeek = members.filter((a) => countIn(a.id, thisWeek, today) > 0).length;

  const pending = people.filter((a) => a.status === 'invited' && !a.approved);
  const ready = people.filter((a) => (a.status === 'invited' && a.approved) || (a.status === 'active' && !a.firstSeenAt));
  const silent = active.filter((a) => a.firstSeenAt && !ready.includes(a) && countIn(a.id, addDays(today, -13), today) === 0);
  const norm = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const nameCount = new Map<string, number>();
  for (const a of people) nameCount.set(norm(a.name), (nameCount.get(norm(a.name)) ?? 0) + 1);
  const duplicates = [...nameCount].filter(([, n]) => n > 1).map(([n]) => people.find((a) => norm(a.name) === n)!.name);
  const brief = (a: NAthlete) => ({ id: a.id, name: a.name });

  // ── academy
  const candidateOf = new Map(x.candidates.filter((c) => c.athleteId).map((c) => [c.athleteId as string, c]));
  const traineeRows = trainees.map((a) => {
    const done: Record<EntryStep, boolean> = {
      inApp: !!a.firstSeenAt, watch: a.watch, test: x.tested.has(a.id), form: x.formed.has(a.id), plan: x.planned.has(a.id),
    };
    const next = ENTRY_STEPS.find((s) => !done[s]) ?? null;
    const joined = a.academyJoinedOn ?? createdOn(a);
    return { id: a.id, name: a.name, pack: packOf(a), joined, done, next, waitingDays: daysBetween(joined, today), candidateId: candidateOf.get(a.id)?.id ?? null };
  });
  const realCandidates = x.candidates.filter((c) => !/^test /i.test(c.name));
  const reached = (c: NCandidate, stage: string) => stage === 'contact' || c.stages.includes(stage)
    || (stage === 'test' && c.stages.includes('analysis'));
  const funnel = FUNNEL_STAGES.map((s) => ({ stage: s, count: realCandidates.filter((c) => reached(c, s)).length }));
  const openCandidates = realCandidates.filter((c) => !c.athleteId || !trainees.some((t) => t.id === c.athleteId));
  const traineesByWeek = weeks.map((w) => trainees.filter((a) => (a.academyJoinedOn ?? createdOn(a)) <= addDays(w, 6)).length);
  const bands = [4, 5, 6, 7, 8, 9].map((n) => ({ band: n, trainees: trainees.filter((a) => a.bandNumber === n).length }));
  const coaches = active.filter((a) => a.role === 'academy_coach').length;

  // ── growth (from launch)
  const ranIn = (a: NAthlete, w: string) => countIn(a.id, w, addDays(w, 6)) > 0;
  const activeByWeek = weeks.map((w) => people.filter((a) => a.status === 'active' && createdOn(a) <= addDays(w, 6) && ranIn(a, w)).length);
  const packsByWeek = Object.fromEntries(CLUB_PACKS.map((p) => [p, weeks.map((w) => active.filter((a) => !a.isAcademy && packOf(a) === p && createdOn(a) <= addDays(w, 6)).length)]));
  const perRunner = (ids: NAthlete[]) => fullWeeks.map((w) => {
    const inApp = ids.filter((a) => createdOn(a) <= addDays(w, 6));
    return inApp.length ? r1(weekKm(w, inApp) / inApp.length) : null;
  });

  // ── packs (calendar year to date)
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const months = Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => i + 1);
  const yearRuns = runs.filter((r) => r.date >= yearStart);
  const packMonthKm: Record<string, number[]> = {};
  const pace: Record<string, Array<number | null>> = {};
  for (const p of [...CLUB_PACKS, 'אקדמיה']) {
    const inPack = (id: string) => { const a = byId.get(id)!; return p === 'אקדמיה' ? a.isAcademy : !a.isAcademy && packOf(a) === p; };
    packMonthKm[p] = months.map((m) => Math.round(yearRuns.filter((r) => Number(r.date.slice(5, 7)) === m && inPack(r.athleteId)).reduce((s, r) => s + r.km, 0)));
    pace[p] = months.map((m) => {
      const ps = yearRuns.filter((r) => Number(r.date.slice(5, 7)) === m && inPack(r.athleteId) && r.km >= 5 && r.km <= 25 && r.type !== 'treadmill_running' && r.seconds > 0)
        .map((r) => r.seconds / 60 / r.km).filter((v) => v > 3 && v < 8);
      const md = median(ps); return md == null ? null : Math.round(md * 100) / 100;
    });
  }
  const since4m = addDays(today, -120);
  const shareRows = [...CLUB_PACKS, 'אקדמיה'].map((p) => {
    const ids = members.filter((a) => (p === 'אקדמיה' ? a.isAcademy : !a.isAcademy && packOf(a) === p));
    return { pack: p, runners: ids.length, km: Math.round(ids.reduce((s, a) => s + kmIn(a.id, since4m, today), 0)) };
  }).filter((r) => r.runners > 0);

  // ── per runner: consistency, attention, core
  const last12 = fullWeeks.slice(-12); const last8 = fullWeeks.slice(-8);
  const yearWeeks: string[] = []; for (let w = sundayOf(yearStart); w < thisWeek; w = addDays(w, 7)) yearWeeks.push(w);
  const runnerRows = members.map((a) => {
    const counts12 = last12.map((w) => countIn(a.id, w, addDays(w, 6)));
    const km12 = last12.map((w) => r1(kmIn(a.id, w, addDays(w, 6))));
    let streak = 0; for (let i = yearWeeks.length - 1; i >= 0; i--) { if (countIn(a.id, yearWeeks[i], addDays(yearWeeks[i], 6)) > 0) streak++; else break; }
    const mean = km12.reduce((s, v) => s + v, 0) / (km12.length || 1);
    const sd = Math.sqrt(km12.reduce((s, v) => s + (v - mean) ** 2, 0) / (km12.length || 1));
    const rec2 = (km12.at(-1)! + km12.at(-2)!) / 2; const prev6 = km12.slice(-8, -2).reduce((s, v) => s + v, 0) / 6;
    const last7 = kmIn(a.id, addDays(today, -6), today); const weekly28 = kmIn(a.id, addDays(today, -27), today) / 4;
    const long = (runsBy.get(a.id) ?? []).filter((r) => r.date >= addDays(today, -13)).reduce((m, r) => (r.km > m.km ? { km: r1(r.km), date: r.date } : m), { km: 0, date: null as string | null });
    const teamHit = fullWeeks.slice(-4).reduce((s, w) => s + teamDays.filter((d) => countIn(a.id, addDays(w, d), addDays(w, d)) > 0).length, 0);
    return {
      id: a.id, name: a.name, pack: packOf(a), academy: a.isAcademy,
      runs8: last8.reduce((s, w) => s + countIn(a.id, w, addDays(w, 6)), 0),
      weeks3plus8: last8.filter((w) => countIn(a.id, w, addDays(w, 6)) >= 3).length,
      weeksRun8: last8.filter((w) => countIn(a.id, w, addDays(w, 6)) > 0).length,
      counts12, km12, streak, cv: mean > 0 ? Math.round((sd / mean) * 100) / 100 : null,
      avg4: r1(km12.slice(-4).reduce((s, v) => s + v, 0) / 4), rec2: Math.round(rec2), prev6: Math.round(prev6),
      change: prev6 > 0 ? Math.round((rec2 / prev6 - 1) * 100) : null,
      days: Array.from({ length: 7 }, (_, i) => r1(kmIn(a.id, addDays(thisWeek, i), addDays(thisWeek, i)))),
      soFar: r1(kmIn(a.id, thisWeek, today)), last7: Math.round(last7), weekly28: Math.round(weekly28), load: loadState(last7, weekly28),
      long, teamHit, teamOf: teamDays.length * 4,
      lastSeen: a.lastSeenAt ? a.lastSeenAt.slice(0, 10) : null,
    };
  });
  const auto = new Set(runnerRows.filter((r) => r.weeks3plus8 === last8.length && last8.length > 0).map((r) => r.id));
  for (const id of x.coreOverride?.add ?? []) auto.add(id);
  for (const id of x.coreOverride?.remove ?? []) auto.delete(id);
  const core = runnerRows.filter((r) => auto.has(r.id)).sort((p, q) => q.avg4 - p.avg4);

  const attention = {
    dropping: runnerRows.filter((r) => r.change != null && r.change <= -20).sort((p, q) => (p.change ?? 0) - (q.change ?? 0))
      .map((r) => ({ id: r.id, name: r.name, pack: r.pack, from: r.prev6, to: r.rec2, change: r.change })),
    notOpening: active.filter((a) => a.lastSeenAt && a.lastSeenAt.slice(0, 10) < monthAgo).map((a) => ({ id: a.id, name: a.name, pack: packOf(a), lastSeen: a.lastSeenAt!.slice(0, 10) })),
    notStarted: active.filter((a) => !(runsBy.get(a.id)?.length)).map(brief),
    invited: people.filter((a) => a.status === 'invited').length,
  };

  // ── insights (calendar year)
  const hours = Array.from({ length: 24 }, (_, h) => yearRuns.filter((r) => localHour(r.start) === h).length);
  const dow = Array.from({ length: 7 }, (_, d) => yearRuns.filter((r) => new Date(`${r.date}T12:00:00Z`).getUTCDay() === d).length);
  const dist = [0, 5, 10, 15, 20, 25, 30, 35].map((k) => yearRuns.filter((r) => (k === 35 ? r.km >= 35 : r.km >= k && r.km < k + 5)).length);
  const treadmill = months.map((m) => { const ms = yearRuns.filter((r) => Number(r.date.slice(5, 7)) === m); return ms.length ? Math.round((ms.filter((r) => r.type === 'treadmill_running').length / ms.length) * 100) : 0; });
  const longRuns = months.map((m) => yearRuns.filter((r) => Number(r.date.slice(5, 7)) === m && r.km >= 20).length);
  const ages = members.map((a) => a.birthDate).filter(Boolean).map((b) => Math.floor(daysBetween(b as string, today) / 365.25)).sort((p, q) => p - q);
  const gender = { female: members.filter((a) => a.gender === 'female').length, known: members.filter((a) => a.gender).length };

  return {
    today, thisWeek, dayIndex: dayIdx, launch, launchDate, weeks,
    overview: {
      club: {
        members: club.length, newThisMonth: club.filter((a) => createdOn(a) >= monthAgo).length,
        ranThisWeek: runnersThisWeek, opened7: active.filter((a) => a.lastSeenAt && a.lastSeenAt.slice(0, 10) >= addDays(today, -6)).length, accountsActive: active.length,
        weeklyKm, soFar, lastSame, lastFull, projected: lastSame > 0 ? Math.round((soFar / lastSame) * lastFull) : null,
        accounts, accountsNewMonth: people.filter((a) => createdOn(a) >= monthAgo).length, invited: attention.invited,
        entry: { pending: pending.map(brief), ready: ready.map(brief), silent: silent.map(brief), active: members.length - silent.length, duplicates },
      },
      academy: {
        trainees: trainees.length, newThisMonth: trainees.filter((a) => (a.academyJoinedOn ?? '') >= monthAgo).length,
        entering: traineeRows.filter((t) => t.next).length, coaches, bandsTotal: 6,
        traineeRows, openCandidates: openCandidates.map((c) => ({ id: c.id, name: c.name, source: c.source })),
      },
    },
    growth: {
      accounts, activeByWeek, packsByWeek, traineesByWeek,
      weeklyKm: weeklyKm.map((w) => w.km),
      perRunnerClub: perRunner(active.filter((a) => !a.isAcademy)), perRunnerAcademy: perRunner(trainees),
    },
    packs: { months, packMonthKm, pace, share: shareRows, sizeNow: Object.fromEntries(CLUB_PACKS.map((p) => [p, packsByWeek[p].at(-1) ?? 0])), sizeAtLaunch: Object.fromEntries(CLUB_PACKS.map((p) => [p, packsByWeek[p][0] ?? 0])) },
    academy: { trainees: traineeRows, traineesByWeek, funnel, bands, coaches, monthKm: packMonthKm['אקדמיה'] },
    insights: { hours, dow, dist, treadmill, longRuns, months, ages, gender, runs: yearRuns.length, teamDays },
    stability: {
      everyWeekSinceJan: runnerRows.filter((r) => r.streak >= yearWeeks.length && yearWeeks.length > 0).length, weeksSinceJan: yearWeeks.length,
      threePlusAll8: runnerRows.filter((r) => r.weeks3plus8 === last8.length).length,
      ran7of8: runnerRows.filter((r) => r.weeksRun8 >= 7).length,
      runsPerWeek: runnerRows.length ? r1(runnerRows.reduce((s, r) => s + r.runs8, 0) / runnerRows.length / 8) : 0,
      runners: runnerRows.map((r) => ({ id: r.id, name: r.name, pack: r.pack, counts12: r.counts12, runs8: r.runs8, cv: r.cv, avg12: r1(r.km12.reduce((s, v) => s + v, 0) / 12) })),
      members: runnerRows.length,
    },
    attention,
    core: { rule: '3+ runs in each of the last 8 weeks', runners: core, all: runnerRows.map((r) => ({ id: r.id, name: r.name, pack: r.pack, inCore: auto.has(r.id) })) },
  };
}

export type ClubNumbers = ReturnType<typeof computeClubNumbers>;
