import type { createServerClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { israelToday } from '@/lib/utils';
import { isCoreRunner } from '@/lib/core-runner';
import { addMonths, computeMonthlySeries, monthsOf, type MAthlete, type NumbersWindow } from './monthly';
import { computeMonthlyExtra, type XAthlete } from './monthly-extra';
import { loadPlanDays, planWorkoutLists } from '@/lib/quality-session/server';
import { weekQuality } from '@/lib/quality-session/plan-days';
import { addDays, RUN_TYPES, computeClubNumbers, type NAthlete, type NCandidate, type NRun } from './compute';

type Db = ReturnType<typeof createServerClient>;

const nextMonth = (iso: string) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

/** Every table "מדרגות במספרים" reads, in one round of queries. A table that is not there yet reads as empty. */
export async function loadClubNumbers(supabase: Db, today = israelToday()) {
  const from = addDays(`${today.slice(0, 4)}-01-01`, -7);
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => { try { const r = await p; return r.error ? [] : (r.data ?? []); } catch { return []; } };
  const [ath, groups, bands, cands, events, tests, chars, plans, settings] = await Promise.all([
    safe(supabase.from('athletes').select('id, name, status, role, is_super_user, is_academy, academy_band_id, academy_joined_on, group_id, created_at, first_seen_at, last_seen_at, approved, garmin_auth:has_garmin, strava_auth:has_strava, birth_date, gender, is_core_runner')),
    safe(supabase.from('groups').select('id, name')),
    safe(supabase.from('academy_bands').select('id, band_number')),
    safe(supabase.from('academy_candidates').select('id, name, source, created_at, athlete_id')),
    safe(supabase.from('academy_candidate_events').select('candidate_id, stage')),
    safe(supabase.from('academy_tests').select('athlete_id, status')),
    safe(supabase.from('academy_characterizations').select('candidate_id, available_days, weekly_km')),
    safe(supabase.from('weekly_plans').select('athlete_id').not('athlete_id', 'is', null).limit(5000)),
    safe(supabase.from('app_settings').select('key, value').in('key', ['reminder_config'])),
  ]);
  // One window per month, all at once: eight pages read one after the other took ~8 s, most of
  // a serverless function's budget, before anything was computed.
  type RunRow = { athlete_id: string; start_time: string; distance: number | null; duration: number | null; moving_duration: number | null; activity_type: string };
  const windows: Array<[string, string]> = [];
  for (let m = from; m <= today; ) {
    const next = m < `${today.slice(0, 4)}-01-01` ? `${today.slice(0, 4)}-01-01` : `${nextMonth(m)}`;
    windows.push([m, next]); m = next;
  }
  const runs = (await Promise.all(windows.map(([a0, b0]) => fetchAllRows<RunRow>((a, b) =>
    supabase.from('athlete_activities').select('id, athlete_id, start_time, distance, duration, moving_duration, activity_type')
      .gte('start_time', `${a0}T00:00:00`).lt('start_time', `${b0}T00:00:00`).order('id').range(a, b))))).flat();

  const G = new Map((groups as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
  const B = new Map((bands as Array<{ id: string; band_number: number }>).map((b) => [b.id, b.band_number]));
  const athletes: NAthlete[] = (ath as Array<Record<string, any>>).map((a) => ({
    id: a.id, name: a.name || '—', status: a.status ?? null, role: a.role ?? null,
    isAcademy: !!a.is_academy, bandNumber: a.academy_band_id ? B.get(a.academy_band_id) ?? null : null, academyJoinedOn: a.academy_joined_on ?? null,
    groupName: a.group_id ? G.get(a.group_id) ?? null : null, createdAt: a.created_at, firstSeenAt: a.first_seen_at ?? null, lastSeenAt: a.last_seen_at ?? null,
    approved: !!a.approved, watch: !!(a.garmin_auth || a.strava_auth), birthDate: a.birth_date ?? null, gender: a.gender ?? null,
    core: isCoreRunner(a),
  }));
  const stagesBy = new Map<string, string[]>();
  for (const e of events as Array<{ candidate_id: string; stage: string }>) (stagesBy.get(e.candidate_id) ?? stagesBy.set(e.candidate_id, []).get(e.candidate_id)!).push(e.stage);
  const candidates: NCandidate[] = (cands as Array<Record<string, any>>).map((c) => ({ id: c.id, name: c.name || '—', source: c.source ?? null, createdAt: c.created_at, athleteId: c.athlete_id ?? null, stages: stagesBy.get(c.id) ?? [] }));
  const athleteOfCandidate = new Map(candidates.filter((c) => c.athleteId).map((c) => [c.id, c.athleteId as string]));
  const formed = new Set((chars as Array<{ candidate_id: string; available_days: number[] | null; weekly_km: number | null }>)
    .filter((c) => (c.available_days?.length ?? 0) > 0 && c.weekly_km != null).map((c) => athleteOfCandidate.get(c.candidate_id)).filter(Boolean) as string[]);
  const set = (key: string) => (settings as Array<{ key: string; value: string }>).find((s) => s.key === key)?.value;
  let teamDays: number[] | undefined;
  try { teamDays = JSON.parse(set('reminder_config') || '{}').teamDays; } catch { teamDays = undefined; }

  return computeClubNumbers({
    today, athletes, candidates,
    runs: runs.map((r): NRun => ({ athleteId: r.athlete_id, start: r.start_time, meters: r.distance ?? 0, seconds: r.moving_duration || r.duration || 0, type: r.activity_type })),
    tested: new Set((tests as Array<{ athlete_id: string; status: string }>).filter((t) => ['approved', 'ok', 'done', 'analysed', 'analyzed'].includes(t.status)).map((t) => t.athlete_id)),
    formed, planned: new Set((plans as Array<{ athlete_id: string }>).map((p) => p.athlete_id)),
    teamDays,
  });
}

// ── monthly series (?window=) ───────────────────────────────────────────────────────

/** Every row the monthly series reads, paged past PostgREST's 1000-row cap. */
export async function loadClubMonthly(supabase: Db, window: NumbersWindow, today = israelToday()) {
  // removed_at is migration 209, pasted by hand: until it is there, read without it.
  const base = 'id, name, role, status, created_at';
  type ARow = { id: string; name: string | null; role: string | null; status: string | null; created_at: string; removed_at?: string | null };
  const page = (cols: string) => fetchAllRows<ARow>((a, b) => supabase.from('athletes').select(cols).order('id').range(a, b) as unknown as PromiseLike<{ data: ARow[] | null; error: unknown }>);
  let ath: ARow[];
  try { ath = await page(`${base}, removed_at`); } catch { ath = await page(base); }
  const athletes: MAthlete[] = ath.map((a) => ({ id: a.id, name: a.name || '—', role: a.role, status: a.status, createdAt: a.created_at, ...('removed_at' in a ? { removedAt: a.removed_at ?? null } : {}) }));
  const earliest = athletes.reduce<string | undefined>((m, a) => (!m || a.createdAt < m ? a.createdAt.slice(0, 10) : m), undefined);
  const months = monthsOf(window, today, earliest);
  const from = `${months[0]}-01`;
  const end = `${addMonths(months.at(-1)!, 1)}-01`;

  type RunRow = { athlete_id: string; start_time: string; distance: number | null; duration: number | null; moving_duration: number | null; activity_type: string };
  const types = [...RUN_TYPES];
  const runs = (await Promise.all(months.map((m) => fetchAllRows<RunRow>((a, b) =>
    supabase.from('athlete_activities').select('id, athlete_id, start_time, distance, duration, moving_duration, activity_type')
      .in('activity_type', types).gte('start_time', `${m}-01T00:00:00`).lt('start_time', `${addMonths(m, 1)}-01T00:00:00`).order('id').range(a, b))))).flat();

  type Ev = { athlete_id: string; created_at: string };
  const events = async (table: string, extra?: (q: any) => any): Promise<Ev[]> => {
    try {
      return await fetchAllRows<Ev>((a, b) => {
        let q: any = supabase.from(table).select('id, athlete_id, created_at').gte('created_at', from).lt('created_at', end);
        if (extra) q = extra(q);
        return q.order('id').range(a, b);
      });
    } catch { return []; } // a table that is not there yet reads as empty
  };
  const [kudos, comments, pain] = await Promise.all([
    events('activity_kudos'),
    events('feed_comments', (q) => q.is('deleted_at', null)),
    events('pain_reports'),
  ]);
  const ev = (rows: Ev[]) => rows.map((r) => ({ athleteId: r.athlete_id, createdAt: r.created_at }));
  const mruns = runs.map((r) => ({ athleteId: r.athlete_id, start: r.start_time, meters: r.distance ?? 0, seconds: r.moving_duration || r.duration || 0, type: r.activity_type }));
  const base_ = computeMonthlySeries({ today, window, athletes, runs: mruns, kudos: ev(kudos), comments: ev(comments), pain: ev(pain) });
  const extra = await loadMonthlyExtra(supabase, athletes, base_.months, mruns);
  return {
    ...base_,
    packs: extra.packs,
    cohorts: extra.cohorts,
    series: base_.series.map((m, i) => ({ ...m, ...extra.series[i] })),
  };
}

/** Every read is best-effort: a table or column that is not there yet reads as empty, and the section says null. */
async function loadMonthlyExtra(supabase: Db, athletes: MAthlete[], months: string[], runs: Array<{ athleteId: string; start: string; meters: number; type: string }>) {
  const from = `${months[0]}-01`, end = `${addMonths(months.at(-1)!, 1)}-01`;
  const all = async <T,>(make: (a: number, b: number) => any): Promise<T[]> => { try { return await fetchAllRows<T>(make); } catch { return []; } };
  const dateOf = (week: string, day: number) => addDays(week, day);

  type A = { id: string; group_id: string | null; is_academy: boolean | null; academy_joined_on: string | null; has_garmin: boolean | null; has_strava: boolean | null; garmin_connected_at?: string | null; strava_connected_at?: string | null };
  const cols = 'id, group_id, is_academy, academy_joined_on, has_garmin, has_strava';
  let arows = await all<A>((a, b) => supabase.from('athletes').select(`${cols}, garmin_connected_at, strava_connected_at`).order('id').range(a, b));
  if (!arows.length) arows = await all<A>((a, b) => supabase.from('athletes').select(cols).order('id').range(a, b)); // 192 not applied
  const groups = await all<{ id: string; name: string }>((a, b) => supabase.from('groups').select('id, name').order('id').range(a, b));
  const G = new Map(groups.map((g) => [g.id, g.name]));
  const A = new Map(arows.map((r) => [r.id, r]));
  const people = athletes.filter((a) => !/^test /i.test(a.name) && a.role !== 'admin');
  const xa: XAthlete[] = people.map((a) => {
    const r = A.get(a.id);
    return {
      id: a.id, createdAt: a.createdAt, status: a.status, ...('removedAt' in a ? { removedAt: a.removedAt } : {}),
      groupName: r?.group_id ? G.get(r.group_id) ?? null : null, isAcademy: !!r?.is_academy, academyJoinedOn: r?.academy_joined_on ?? null,
      garmin: !!r?.has_garmin, strava: !!r?.has_strava, garminConnectedAt: r?.garmin_connected_at ?? null, stravaConnectedAt: r?.strava_connected_at ?? null,
    };
  });
  const ids = new Set(xa.map((a) => a.id));

  const weekFrom = addDays(from, -6);
  const [hist, u21, rsvps, presence, races, plans, planDays] = await Promise.all([
    all<{ athlete_id: string; group_id: string | null; from_date: string }>((a, b) => supabase.from('athlete_pack_history').select('id, athlete_id, group_id, from_date').order('id').range(a, b)),
    all<{ created_at: string }>((a, b) => supabase.from('u21_registrations').select('id, created_at').gte('created_at', from).lt('created_at', end).order('id').range(a, b)),
    all<{ athlete_id: string; week_start_date: string; day_of_week: number; attending: boolean }>((a, b) => supabase.from('workout_attendance').select('id, athlete_id, week_start_date, day_of_week, attending').gte('week_start_date', weekFrom).lt('week_start_date', end).order('id').range(a, b)),
    all<{ athlete_id: string; week_start: string; day: number; present: boolean }>((a, b) => supabase.from('practice_presence').select('id, athlete_id, week_start, day, present').gte('week_start', weekFrom).lt('week_start', end).order('id').range(a, b)),
    all<{ athlete_id: string; distance: string; seconds: number; race_date: string }>((a, b) => supabase.from('race_results').select('id, athlete_id, distance, seconds, race_date').is('deleted_at', null).lt('race_date', end).order('id').range(a, b)),
    all<{ id: string; week_start_date: string; parsed_workouts: unknown; created_at: string }>((a, b) => supabase.from('weekly_plans').select('id, week_start_date, parsed_workouts, created_at').is('athlete_id', null).gte('week_start_date', from).lt('week_start_date', end).order('id').range(a, b)),
    loadPlanDays(supabase).catch(() => ({} as Record<string, number[]>)),
  ]);

  // The latest group plan per week, as the plan screen reads it.
  const latest = new Map<string, (typeof plans)[number]>();
  for (const p of plans) { const cur = latest.get(p.week_start_date); if (!cur || p.created_at > cur.created_at) latest.set(p.week_start_date, p); }
  const planIds = [...latest.values()].map((p) => p.id);
  const matches = planIds.length
    ? await all<{ athlete_id: string; weekly_plan_id: string; workout_key: string }>((a, b) => supabase.from('activity_plan_matches').select('id, athlete_id, weekly_plan_id, workout_key').in('weekly_plan_id', planIds).order('id').range(a, b))
    : [];
  const weekOfPlan = new Map([...latest.values()].map((p) => [p.id, p.week_start_date]));

  const inRange = (d: string) => d >= from && d < end;
  return computeMonthlyExtra({
    months,
    athletes: xa,
    runs: runs.filter((r) => ids.has(r.athleteId) && r.meters > 0).map((r) => ({ athleteId: r.athleteId, date: r.start.slice(0, 10), km: r.meters / 1000 })),
    packHistory: hist.map((h) => ({ athleteId: h.athlete_id, groupName: h.group_id ? G.get(h.group_id) ?? null : null, fromDate: h.from_date })),
    u21: u21.map((u) => ({ createdAt: u.created_at })),
    rsvps: rsvps.filter((r) => ids.has(r.athlete_id)).map((r) => ({ athleteId: r.athlete_id, date: dateOf(r.week_start_date, r.day_of_week), attending: r.attending })).filter((r) => inRange(r.date)),
    presence: presence.filter((p) => ids.has(p.athlete_id)).map((p) => ({ athleteId: p.athlete_id, date: dateOf(p.week_start, p.day), present: p.present })).filter((p) => inRange(p.date)),
    races: races.filter((r) => ids.has(r.athlete_id)).map((r) => ({ athleteId: r.athlete_id, distance: r.distance, seconds: r.seconds, date: r.race_date })),
    plans: [...latest.values()].map((p) => {
      const lists = planWorkoutLists(p.parsed_workouts);
      const keyDay: Record<string, number> = {};
      for (const w of lists.flat()) if (w.workoutKey && typeof w.dayOfWeek === 'number') keyDay[w.workoutKey] = w.dayOfWeek;
      return { weekStart: p.week_start_date, qualityDays: weekQuality(lists, planDays[p.week_start_date]).days, keyDay };
    }),
    matches: matches.filter((m) => ids.has(m.athlete_id) && weekOfPlan.has(m.weekly_plan_id)).map((m) => ({ athleteId: m.athlete_id, weekStart: weekOfPlan.get(m.weekly_plan_id)!, workoutKey: m.workout_key })),
  });
}
