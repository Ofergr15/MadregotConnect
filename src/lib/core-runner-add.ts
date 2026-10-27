import type { createServerClient } from '@/lib/supabase/server';
import { listRounds } from '@/lib/podium/server';
import { roundState, type PodiumRound } from '@/lib/podium/model';
import { openCopy } from '@/lib/podium/notify';

// The "add to the core?" sheet (mockup ~/.cache/madregot/core-add, Ofer 10-27): who it is,
// the welcome push as it will read, and — when a store order is open to the core — that
// order's push to this one person. Both editable, both optional.

type Db = ReturnType<typeof createServerClient>;

export function welcomeCopy(name: string | null | undefined, gender: string | null | undefined, perks: number) {
  const first = (name || '').trim().split(/\s+/)[0];
  const she = gender === 'female';
  return {
    title: `🌟 ${she ? 'ברוכה הבאה' : 'ברוך הבא'} לגרעין${first ? `, ${first}` : ''}!`,
    body: `${perks} הטבות מחכות לך: נעליים, פיזיו, LIFT ועוד`,
  };
}

/** The store order a new core runner joins: open now, not sent, open to the core. */
export async function openCoreRound(db: Db): Promise<{ round: PodiumRound; raw: Record<string, unknown> } | null> {
  const rounds = await listRounds(db as never).catch(() => [] as PodiumRound[]);
  const round = rounds.find((r) => roundState(r) === 'open' && (r.audience === 'core' || r.audience === 'all'));
  if (!round) return null;
  const { data } = await db.from('podium_rounds').select('*').eq('id', round.id).maybeSingle();
  return data ? { round, raw: data as Record<string, unknown> } : null;
}

export async function addPreview(db: Db, athleteId: string) {
  const since = new Date(Date.now() - 56 * 86_400_000).toISOString();
  const [{ data: a }, { count: perks }, { data: runs }, open] = await Promise.all([
    db.from('athletes').select('id, name, gender, created_at, group_id, groups!group_id(name)').eq('id', athleteId).maybeSingle(),
    db.from('club_perks').select('id', { count: 'exact', head: true }).eq('active', true).eq('tier', 'core_runner'),
    db.from('athlete_activities').select('distance, workout_title, activity_type').eq('athlete_id', athleteId).gte('start_time', since),
    openCoreRound(db),
  ]);
  const row = a as { name: string | null; gender: string | null; created_at: string | null; groups?: { name?: string } | null } | null;
  const list = ((runs || []) as Array<{ distance: number | null; workout_title: string | null; activity_type: string | null }>)
    .filter((r) => !r.activity_type || /run/i.test(r.activity_type));
  return {
    person: {
      name: row?.name ?? null,
      group: row?.groups?.name ?? null,
      since: row?.created_at ?? null,
      runs8: list.length,
      km8: Math.round(list.reduce((s, r) => s + (r.distance || 0), 0) / 1000),
      quality8: list.filter((r) => !!r.workout_title).length,
    },
    welcome: welcomeCopy(row?.name, row?.gender, perks ?? 0),
    podium: open ? { roundId: open.round.id, title: open.round.title, locksAt: open.round.locksAt, copy: openCopy(open.round, open.raw) } : null,
  };
}
