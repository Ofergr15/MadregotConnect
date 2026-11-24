import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { resolveRaceSeat } from '@/lib/packs/race-access-server';
import { mayWriteRacePlan, parseRacePlan } from '@/lib/packs/races';

export const dynamic = 'force-dynamic';

/**
 * /api/academy/race-plan?race=<id> — a coach's plan for an athlete's own race (migration 217).
 * GET: the athlete, a coach of theirs, or the manager seat. PUT: a coach of theirs or the
 * manager seat only — the athlete reads it, never writes it.
 */
async function load(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied } as const;
  const raceId = new URL(request.url).searchParams.get('race');
  if (!raceId) return { denied: NextResponse.json({ error: 'race required' }, { status: 400 }) } as const;
  const db = createServerClient();
  const { data: race } = await db.from('athlete_races').select('id, athlete_id').eq('id', raceId).maybeSingle();
  if (!race) return { denied: NextResponse.json({ error: 'not found' }, { status: 404 }) } as const;
  const seat = await resolveRaceSeat(db, caller, race.athlete_id);
  if (!seat) return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  return { denied: null, db, caller, seat, raceId } as const;
}

async function readPlan(db: ReturnType<typeof createServerClient>, raceId: string) {
  const { data } = await db.from('race_plans')
    .select('race_id, goal_sec, segments, fuel, note, author_id, sent_at').eq('race_id', raceId).maybeSingle();
  if (!data) return null;
  let authorName: string | null = null;
  if (data.author_id) {
    const { data: a } = await db.from('athletes').select('name').eq('id', data.author_id).maybeSingle();
    authorName = a?.name ?? null;
  }
  return {
    raceId: data.race_id, goalSec: data.goal_sec, segments: data.segments, fuel: data.fuel,
    note: data.note, authorName, sentAt: data.sent_at,
  };
}

export async function GET(request: Request) {
  try {
    const g = await load(request);
    if (g.denied) return g.denied;
    return NextResponse.json({ plan: await readPlan(g.db, g.raceId) });
  } catch (err: any) {
    console.error('GET /api/academy/race-plan error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const g = await load(request);
    if (g.denied) return g.denied;
    if (!mayWriteRacePlan(g.seat)) return NextResponse.json({ error: 'coach or staff only' }, { status: 403 });
    if (g.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
    const plan = parseRacePlan(await request.json().catch(() => ({})));
    if (!plan) return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await g.db.from('race_plans').upsert({
      race_id: g.raceId, goal_sec: plan.goalSec, segments: plan.segments, fuel: plan.fuel, note: plan.note,
      author_id: g.caller.athleteId, sent_at: now, updated_at: now,
    }, { onConflict: 'race_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plan: await readPlan(g.db, g.raceId) });
  } catch (err: any) {
    console.error('PUT /api/academy/race-plan error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
