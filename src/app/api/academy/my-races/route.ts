import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { resolveRaceSeat } from '@/lib/packs/race-access-server';
import { parseRaceBody, toRace, type RaceRow } from '@/lib/packs/races';

export const dynamic = 'force-dynamic';

const RACE_COLS = 'id, athlete_id, name, race_date, distance_m, goal_sec, created_by, coach_seen_at';

/**
 * /api/academy/my-races — an athlete's own races (migration 217).
 *
 * Gate: `mayActFor`, narrowed — the athlete themselves, a coach of THAT athlete
 * (academy_trainee_coaches), or the academy manager seat. Any other coach is refused even
 * though `mayActFor` alone would let every staff account in (races.ts `raceSeat`).
 */
async function gate(request: Request, athleteParam: string | null) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied } as const;
  const athleteId = athleteParam?.trim() || caller.athleteId;
  if (!athleteId) return { denied: NextResponse.json({ error: 'athlete required' }, { status: 400 }) } as const;
  const db = createServerClient();
  const seat = await resolveRaceSeat(db, caller, athleteId);
  if (!seat) return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  return { denied: null, caller, athleteId, seat, db } as const;
}

async function ownRace(db: ReturnType<typeof createServerClient>, id: string | null) {
  if (!id) return null;
  const { data } = await db.from('athlete_races').select(RACE_COLS).eq('id', id).maybeSingle();
  return (data as RaceRow | null) ?? null;
}

export async function GET(request: Request) {
  try {
    const g = await gate(request, new URL(request.url).searchParams.get('athlete'));
    if (g.denied) return g.denied;
    const { db, athleteId, seat, caller } = g;
    const { data, error } = await db.from('athlete_races').select(RACE_COLS)
      .eq('athlete_id', athleteId).order('race_date', { ascending: true });
    if (error) return NextResponse.json({ races: [], migrationPending: true });
    const rows = (data || []) as RaceRow[];
    const ids = rows.map((r) => r.id);
    const { data: plans } = ids.length ? await db.from('race_plans').select('race_id').in('race_id', ids) : { data: [] };
    const withPlan = new Set(((plans || []) as Array<{ race_id: string }>).map((p) => p.race_id));
    // A coach opening the list is the "coach saw it" moment; never while an admin views as.
    if (seat !== 'self' && !caller.viewingAsBy) {
      const unseen = rows.filter((r) => !r.coach_seen_at).map((r) => r.id);
      if (unseen.length) await db.from('athlete_races').update({ coach_seen_at: new Date().toISOString() }).in('id', unseen);
    }
    return NextResponse.json({ races: rows.map((r) => toRace(r, withPlan.has(r.id))) });
  } catch (err: any) {
    console.error('GET /api/academy/my-races error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const g = await gate(request, new URL(request.url).searchParams.get('athlete'));
    if (g.denied) return g.denied;
    const body = await request.json().catch(() => ({}));
    const parsed = parseRaceBody(body, false);
    if (!parsed.ok) return NextResponse.json({ error: `invalid ${parsed.field}`, field: parsed.field }, { status: 400 });
    const { data, error } = await g.db.from('athlete_races')
      .insert({ ...parsed.row, athlete_id: g.athleteId, created_by: g.caller.athleteId })
      .select(RACE_COLS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ race: toRace(data as RaceRow, false) }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/academy/my-races error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

async function forRace(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  const pre = await resolveVerifiedCaller(request);
  if (pre.denied) return { denied: pre.denied } as const;
  const race = await ownRace(createServerClient(), id);
  if (!race) return { denied: NextResponse.json({ error: 'not found' }, { status: 404 }) } as const;
  const g = await gate(request, race.athlete_id);
  if (g.denied) return { denied: g.denied } as const;
  return { ...g, race } as const;
}

export async function PATCH(request: Request) {
  try {
    const g = await forRace(request);
    if (g.denied) return g.denied;
    const parsed = parseRaceBody(await request.json().catch(() => ({})), true);
    if (!parsed.ok) return NextResponse.json({ error: `invalid ${parsed.field}`, field: parsed.field }, { status: 400 });
    const { data, error } = await g.db.from('athlete_races')
      .update({ ...parsed.row, updated_at: new Date().toISOString() }).eq('id', g.race.id).select(RACE_COLS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: plan } = await g.db.from('race_plans').select('race_id').eq('race_id', g.race.id).maybeSingle();
    return NextResponse.json({ race: toRace(data as RaceRow, !!plan) });
  } catch (err: any) {
    console.error('PATCH /api/academy/my-races error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const g = await forRace(request);
    if (g.denied) return g.denied;
    const { error } = await g.db.from('athlete_races').delete().eq('id', g.race.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE /api/academy/my-races error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
