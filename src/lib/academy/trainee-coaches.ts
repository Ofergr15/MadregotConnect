import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { joinHebrewList } from './members';

export { joinHebrewList };

// ── A trainee's coaches ──────────────────────────────────────────────────────
//
// THE one place that answers "who coaches this trainee" and "whom does this coach
// hold". Since migration 135 a trainee can have several coaches, all equal; the set
// lives in `academy_trainee_coaches`. `athletes.academy_coach_id` stays as the
// LEGACY first coach and is still written on every change, because the code ships
// before the owner pastes 135 and the column is all that exists until then.
//
// Every read is therefore a UNION of the two: the table's rows plus the legacy
// column. Writes keep them in step (the column is always the first of the set, and
// that coach is always in the table too), so after 135 the union IS the table; before
// 135 the table read fails with 42P01 and the union is the column — one coach, as
// before. Reading the union rather than "table, else column" also means a pair that
// somehow only reached the column is never lost.
//
// Order is meaningful: the legacy (first) coach leads, then the rest by when they
// were added. The first coach is who the audit history follows.

// Loose on purpose: the routes hand in clients typed against different generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const TRAINEE_COACHES_TABLE = 'academy_trainee_coaches';

/** One athletes row, as far as the coach link goes. */
export interface LegacyCoachRow {
  id: string;
  academy_coach_id?: string | null;
}

interface LinkRow { athlete_id: string; coach_id: string; since?: string | null; created_at?: string | null }

/** Ids of a set in the canonical order: the legacy coach first, no repeats, no blanks. */
export function orderCoachIds(legacy: string | null | undefined, others: string[]): string[] {
  const out: string[] = [];
  for (const id of [legacy, ...others]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The coaches of one trainee off a map from `coachIdsByTrainee`, never undefined. */
export function coachesOf(map: Map<string, string[]>, athleteId: string): string[] {
  return map.get(athleteId) ?? [];
}

/** Does this caller coach this trainee, according to a map from `coachIdsByTrainee`? */
export function coachesTrainee(map: Map<string, string[]>, athleteId: string, coachId: string | null | undefined): boolean {
  return !!coachId && coachesOf(map, athleteId).includes(coachId);
}

const CHUNK = 200;

/**
 * The link rows, or `null` when the table isn't there (135 not pasted) or can't be
 * read. Null is "fall back to the legacy column", and it is also what a test double
 * that has never heard of the table produces, so the old single-coach behaviour is
 * what every pre-135 path sees.
 */
async function readLinks(
  supabase: Db,
  filter: { athleteIds?: string[]; coachId?: string },
): Promise<LinkRow[] | null> {
  try {
    const run = async (ids?: string[]): Promise<LinkRow[] | null> => {
      let q = supabase.from(TRAINEE_COACHES_TABLE).select('athlete_id, coach_id, since, created_at');
      if (ids) q = q.in('athlete_id', ids);
      if (filter.coachId) q = q.eq('coach_id', filter.coachId);
      const { data, error } = await q;
      if (error) {
        if (!isMissingTable(error)) console.error('academy_trainee_coaches read failed:', error);
        return null;
      }
      return Array.isArray(data) ? (data as LinkRow[]) : [];
    };
    if (!filter.athleteIds) return await run();
    if (!filter.athleteIds.length) return [];
    const out: LinkRow[] = [];
    for (let i = 0; i < filter.athleteIds.length; i += CHUNK) {
      const page = await run(filter.athleteIds.slice(i, i + CHUNK));
      if (page === null) return null;
      out.push(...page);
    }
    return out;
  } catch (err) {
    console.error('academy_trainee_coaches read threw:', err);
    return null;
  }
}

const byAdded = (a: LinkRow, b: LinkRow) =>
  String(a.since ?? '').localeCompare(String(b.since ?? ''))
  || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  || a.coach_id.localeCompare(b.coach_id);

/** The union of the legacy rows and the link rows, keyed by trainee. */
export function mergeCoachLinks(legacyRows: LegacyCoachRow[], links: LinkRow[] | null): Map<string, string[]> {
  const extra = new Map<string, LinkRow[]>();
  for (const l of links ?? []) {
    if (!l?.athlete_id || !l.coach_id) continue;
    const list = extra.get(l.athlete_id) ?? [];
    list.push(l);
    extra.set(l.athlete_id, list);
  }
  const map = new Map<string, string[]>();
  const legacyOf = new Map(legacyRows.map((r) => [r.id, r.academy_coach_id ?? null]));
  for (const id of new Set([...legacyOf.keys(), ...extra.keys()])) {
    const others = (extra.get(id) ?? []).sort(byAdded).map((l) => l.coach_id);
    map.set(id, orderCoachIds(legacyOf.get(id) ?? null, others).filter((c) => c !== id));
  }
  return map;
}

/**
 * athleteId → coachIds for the given trainees (every club athlete when omitted).
 *
 * Pass `legacyRows` when the caller has already read the athletes rows with
 * `academy_coach_id`, to save the round trip; their ids then stand in for
 * `athleteIds`. Every requested trainee gets an entry, `[]` for none.
 */
export async function coachIdsByTrainee(
  supabase: Db,
  athleteIds?: string[],
  legacyRows?: LegacyCoachRow[],
): Promise<Map<string, string[]>> {
  let legacy: LegacyCoachRow[] = legacyRows ?? [];
  const ids = athleteIds ?? (legacyRows ? legacyRows.map((r) => r.id) : undefined);
  if (!legacyRows) {
    try {
      let q = supabase.from('athletes').select('id, academy_coach_id').eq('coach_id', COACH_ID);
      if (ids) q = q.in('id', ids);
      const { data, error } = await q;
      // Before 077 there is no column: nobody is paired, and that is the answer.
      legacy = error || !Array.isArray(data) ? [] : (data as LegacyCoachRow[]);
    } catch {
      legacy = [];
    }
  }
  // A whole-roster read pulls the (small) table whole rather than in id chunks.
  const linkIds = athleteIds ?? (legacyRows && legacyRows.length <= CHUNK ? ids : undefined);
  const links = await readLinks(supabase, { athleteIds: linkIds });
  const merged = mergeCoachLinks(legacy, links);
  // Scope the table rows to the trainees asked about (the whole-club read may
  // return links for athletes outside `legacy`, which are still club athletes).
  if (ids) {
    const out = new Map<string, string[]>();
    for (const id of ids) out.set(id, merged.get(id) ?? []);
    return out;
  }
  return merged;
}

/** The coaches of one trainee, legacy first. */
export async function coachIdsOf(supabase: Db, athleteId: string, legacyCoachId?: string | null): Promise<string[]> {
  const map = await coachIdsByTrainee(
    supabase,
    [athleteId],
    legacyCoachId === undefined ? undefined : [{ id: athleteId, academy_coach_id: legacyCoachId }],
  );
  return coachesOf(map, athleteId);
}

/** Every trainee this coach holds, alone or shared. */
export async function traineeIdsOfCoach(supabase: Db, coachId: string): Promise<string[]> {
  if (!coachId) return [];
  const ids = new Set<string>();
  try {
    const { data, error } = await supabase
      .from('athletes')
      .select('id')
      .eq('coach_id', COACH_ID)
      .eq('academy_coach_id', coachId);
    if (!error && Array.isArray(data)) for (const r of data as Array<{ id: string }>) if (r.id) ids.add(r.id);
  } catch { /* pre-077: nobody */ }
  const links = await readLinks(supabase, { coachId });
  for (const l of links ?? []) if (l.coach_id === coachId && l.athlete_id) ids.add(l.athlete_id);
  ids.delete(coachId);
  return [...ids];
}

/** Is the shared-coaches table there yet (135 pasted)? */
export async function hasTraineeCoachesTable(supabase: Db): Promise<boolean> {
  try {
    const { error } = await supabase.from(TRAINEE_COACHES_TABLE).select('athlete_id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

export type SetCoachesResult =
  | { ok: true; before: string[]; after: string[]; added: string[]; removed: string[]; unchanged: boolean }
  // `no_schema`: more than one coach asked for before 135 exists — nothing written.
  | { ok: false; reason: 'no_schema' | 'failed' };

/** What changes between two sets, in the order each side lists them. */
export function diffCoachSets(before: string[], after: string[]): { added: string[]; removed: string[] } {
  return {
    added: after.filter((c) => !before.includes(c)),
    removed: before.filter((c) => !after.includes(c)),
  };
}

/**
 * Replace a trainee's coaches with `coachIds` (first = the new legacy coach).
 *
 * Order of writes, each a step safer than the next:
 *   1. `athletes.academy_coach_id` = the first coach, or null. What pre-135 reads
 *      scope on, so it goes first; a failure here fails the whole call.
 *   2. The link table: the set's rows upserted, the removed ones deleted. Skipped
 *      before 135 — where a set of more than one is refused up front, so nothing
 *      half-lands.
 *   3. `academy_coach_history`, FOLLOWING THE FIRST COACH ONLY. Migration 077 keeps
 *      at most one open row per trainee (a unique partial index), so a second open
 *      row for a co-coach can't exist; the trail records who leads. Logged, not fatal.
 *
 * Stream membership is the caller's (pairing-server), so this stays a DB module.
 */
export async function setTraineeCoaches(
  supabase: Db,
  athleteId: string,
  coachIds: string[],
  actor: { reason?: string | null } = {},
): Promise<SetCoachesResult> {
  const after = orderCoachIds(null, coachIds).filter((c) => c !== athleteId);

  const { data: row, error: rowErr } = await supabase
    .from('athletes')
    .select('id, academy_coach_id')
    .eq('id', athleteId)
    .eq('coach_id', COACH_ID)
    .maybeSingle();
  if (rowErr || !row) return { ok: false, reason: 'failed' };
  const links = await readLinks(supabase, { athleteIds: [athleteId] });
  const tablePresent = links !== null;
  const before = coachesOf(mergeCoachLinks([row as LegacyCoachRow], links), athleteId);

  const { added, removed } = diffCoachSets(before, after);
  const unchanged = !added.length && !removed.length && before[0] === after[0];
  if (unchanged) return { ok: true, before, after, added, removed, unchanged: true };
  if (!tablePresent && after.length > 1) return { ok: false, reason: 'no_schema' };

  const lead = after[0] ?? null;
  {
    const { error } = await supabase
      .from('athletes')
      .update({ academy_coach_id: lead })
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID);
    if (error) {
      console.error('Academy coach assign error:', error);
      return { ok: false, reason: 'failed' };
    }
  }

  if (tablePresent) {
    // Logged, not fatal: the legacy column already holds the first coach.
    try {
      const today = israelToday();
      if (removed.length) {
        const del = await supabase.from(TRAINEE_COACHES_TABLE).delete().eq('athlete_id', athleteId).in('coach_id', removed);
        if (del.error) console.error('academy_trainee_coaches delete failed:', del.error);
      }
      if (after.length) {
        const up = await supabase
          .from(TRAINEE_COACHES_TABLE)
          .upsert(after.map((coach_id) => ({ athlete_id: athleteId, coach_id, since: today })), {
            onConflict: 'athlete_id,coach_id',
            ignoreDuplicates: true,
          });
        if (up.error) console.error('academy_trainee_coaches upsert failed:', up.error);
      }
    } catch (err) {
      console.error('academy_trainee_coaches write threw:', err);
    }
  }

  if ((before[0] ?? null) !== lead) {
    const today = israelToday();
    const closed = await supabase
      .from('academy_coach_history')
      .update({ ended_on: today })
      .eq('athlete_id', athleteId)
      .is('ended_on', null);
    if (closed.error) console.error('Academy coach history close failed:', closed.error);
    if (lead) {
      const opened = await supabase
        .from('academy_coach_history')
        .insert({ athlete_id: athleteId, coach_id: lead, started_on: today, reason: actor.reason ?? null });
      if (opened.error) console.error('Academy coach history open failed:', opened.error);
    }
  }

  return { ok: true, before, after, added, removed, unchanged: false };
}
