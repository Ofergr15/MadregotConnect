import type { createServerClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { israelToday } from '@/lib/utils';
import { isCoreRunner } from '@/lib/core-runner';
import { addDays, computeClubNumbers, type NAthlete, type NCandidate, type NRun } from './compute';

type Db = ReturnType<typeof createServerClient>;

/** Every table "מדרגות במספרים" reads, in one round of queries. A table that is not there yet reads as empty. */
export async function loadClubNumbers(supabase: Db, today = israelToday()) {
  const from = addDays(`${today.slice(0, 4)}-01-01`, -7);
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => { try { const r = await p; return r.error ? [] : (r.data ?? []); } catch { return []; } };
  const [ath, groups, bands, cands, events, tests, chars, plans, settings] = await Promise.all([
    safe(supabase.from('athletes').select('id, name, status, role, is_super_user, is_academy, academy_band_id, academy_joined_on, group_id, created_at, first_seen_at, last_seen_at, approved, garmin_auth, strava_auth, birth_date, gender, is_core_runner')),
    safe(supabase.from('groups').select('id, name')),
    safe(supabase.from('academy_bands').select('id, band_number')),
    safe(supabase.from('academy_candidates').select('id, name, source, created_at, athlete_id')),
    safe(supabase.from('academy_candidate_events').select('candidate_id, stage')),
    safe(supabase.from('academy_tests').select('athlete_id, status')),
    safe(supabase.from('academy_characterizations').select('candidate_id, available_days, weekly_km')),
    safe(supabase.from('weekly_plans').select('athlete_id').not('athlete_id', 'is', null).limit(5000)),
    safe(supabase.from('app_settings').select('key, value').in('key', ['reminder_config'])),
  ]);
  const runs = await fetchAllRows<{ athlete_id: string; start_time: string; distance: number | null; duration: number | null; moving_duration: number | null; activity_type: string }>((a, b) =>
    supabase.from('athlete_activities').select('id, athlete_id, start_time, distance, duration, moving_duration, activity_type')
      .gte('start_time', `${from}T00:00:00`).order('id').range(a, b));

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
