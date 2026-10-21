import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { distanceOf, packNumber, relevantSuggestions, type ChampDistance, type ResultRow } from './table';
import { israelToday } from '@/lib/utils';

// The DB half of אלופי המדרגות: approved official results (race_results, 163), and the
// watch's race-day runs that could become one (race_matches) for staff to confirm.

type Db = SupabaseClient;
export const isMissing163 = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /race_results/.test(e.message || ''));

interface Person { id: string; name: string | null; avatar_url: string | null; gender: string | null; group_id: string | null }

async function people(db: Db, ids: string[]): Promise<Map<string, Person & { pack: number | null }>> {
  const out = new Map<string, Person & { pack: number | null }>();
  if (!ids.length) return out;
  const [{ data: a }, { data: g }] = await Promise.all([
    db.from('athletes').select('id, name, avatar_url, gender, group_id').in('id', ids),
    db.from('groups').select('id, name'),
  ]);
  const packs = new Map(((g || []) as { id: string; name: string }[]).map((x) => [x.id, packNumber(x.name)]));
  for (const p of (a || []) as Person[]) out.set(p.id, { ...p, pack: p.group_id ? packs.get(p.group_id) ?? null : null });
  return out;
}

/** Every approved result, with the person. `ready:false` before 163 is pasted. */
export async function readResults(db: Db): Promise<{ ready: boolean; rows: ResultRow[] }> {
  const { data, error } = await db.from('race_results').select('id, athlete_id, distance, seconds, race_name, race_date')
    .is('deleted_at', null).limit(5000);
  if (error) {
    if (isMissing163(error)) return { ready: false, rows: [] };
    throw error;
  }
  const raw = (data || []) as Array<{ id: string; athlete_id: string; distance: ChampDistance; seconds: number; race_name: string | null; race_date: string }>;
  const who = await people(db, [...new Set(raw.map((r) => r.athlete_id))]);
  return {
    ready: true,
    rows: raw.flatMap((r) => {
      const p = who.get(r.athlete_id);
      if (!p) return [];
      return [{ id: r.id, athleteId: r.athlete_id, name: p.name || '', avatarUrl: p.avatar_url, gender: p.gender, pack: p.pack, distance: r.distance, seconds: r.seconds, raceName: r.race_name, raceDate: r.race_date }];
    }),
  };
}

export interface Suggestion { activityId: string; athleteId: string; name: string; avatarUrl: string | null; distance: ChampDistance; watchSeconds: number; raceName: string | null; raceDate: string; gender?: string | null; location?: string | null }

/** Race-day runs at a race distance, not yet a result — newest first. */
export async function readSuggestions(db: Db, taken: Set<string>): Promise<Suggestion[]> {
  const { data } = await db.from('race_matches')
    .select('activity_id, athlete_id, evidence, athlete_activities(distance, duration, start_time), events(name, location)')
    .eq('is_race', true).order('created_at', { ascending: false }).limit(300);
  const rows = (data || []) as unknown as Array<{ activity_id: string; athlete_id: string; evidence: { eventName?: string } | null; athlete_activities: { distance: number | null; duration: number | null; start_time: string } | null; events: { name: string; location: string | null } | null }>;
  const fit = rows.flatMap((r) => {
    const a = r.athlete_activities;
    const d = distanceOf(a?.distance);
    if (!a || !d || !a.duration || taken.has(r.activity_id)) return [];
    return [{ r, a, d }];
  });
  const who = await people(db, [...new Set(fit.map((x) => x.r.athlete_id))]);
  const { data: active } = await db.from('athletes').select('id').eq('coach_id', COACH_ID).neq('status', 'removed').in('id', [...who.keys()]);
  const ok = new Set(((active || []) as { id: string }[]).map((x) => x.id));
  const all = fit.filter((x) => ok.has(x.r.athlete_id)).map(({ r, a, d }) => ({
    activityId: r.activity_id, athleteId: r.athlete_id, name: who.get(r.athlete_id)?.name || '', avatarUrl: who.get(r.athlete_id)?.avatar_url ?? null,
    distance: d, watchSeconds: Math.round(a.duration!), raceName: r.events?.name ?? r.evidence?.eventName ?? null,
    raceDate: new Date(a.start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
    gender: who.get(r.athlete_id)?.gender ?? null,
    location: r.events?.location ?? null,
  }));
  // Only what is worth an approval (Ofer 10-20): a runner's fastest per distance, and
  // only when it enters a top 10 (table.ts relevantSuggestions). Here, so the admin's
  // list, the pending count and the 20:00 push all count the same thing.
  const { rows: results } = await readResults(db);
  return relevantSuggestions(results, all, israelToday());
}
