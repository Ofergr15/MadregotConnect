import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_NAME_LENGTH = 60;

/**
 * GET /api/shoes?athleteId=…
 * The athlete's own shoes, each with its accumulated km (summed from
 * athlete_activities.shoe_id — attributed at sync/log time from whichever
 * shoe was active_shoe_id then, see /api/shoes PATCH setActive) and whether
 * it's the currently-active pair.
 */
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ shoes: [] });

    const supabase = createServerClient();
    const [{ data: athlete }, { data: shoes }, { data: acts }] = await Promise.all([
      supabase.from('athletes').select('active_shoe_id').eq('id', athleteId).maybeSingle(),
      supabase.from('shoes').select('*').eq('athlete_id', athleteId).order('created_at', { ascending: true }),
      supabase.from('athlete_activities').select('shoe_id, distance').eq('athlete_id', athleteId).not('shoe_id', 'is', null),
    ]);

    const kmByShoe = new Map<string, number>();
    for (const a of (acts || []) as Array<{ shoe_id: string; distance: number | null }>) {
      kmByShoe.set(a.shoe_id, (kmByShoe.get(a.shoe_id) || 0) + (a.distance || 0) / 1000);
    }

    const result = (shoes || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.name,
      distanceLimitKm: s.distance_limit_km,
      alertBeforeKm: s.alert_before_km,
      retired: s.retired,
      isActive: s.id === athlete?.active_shoe_id,
      kmUsed: Math.round((kmByShoe.get(s.id as string) || 0) * 10) / 10,
    }));

    return NextResponse.json({ shoes: result });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/shoes  { athleteId, name, distanceLimitKm?, alertBeforeKm? }
 * Creates a shoe. If the athlete has no active shoe yet, this one becomes it
 * (so the very first pair someone adds starts tracking immediately, no
 * separate "set active" step needed for the common single-shoe case).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { athleteId, name } = body;
    if (!athleteId || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'athleteId and name required' }, { status: 400 });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `Name is too long (max ${MAX_NAME_LENGTH})` }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: shoe, error } = await supabase
      .from('shoes')
      .insert({
        athlete_id: athleteId,
        name: name.trim(),
        distance_limit_km: body.distanceLimitKm != null ? Number(body.distanceLimitKm) : null,
        alert_before_km: body.alertBeforeKm != null ? Number(body.alertBeforeKm) : 50,
      })
      .select()
      .single();
    if (error) throw error;

    const { data: athlete } = await supabase.from('athletes').select('active_shoe_id').eq('id', athleteId).maybeSingle();
    if (!athlete?.active_shoe_id) {
      await supabase.from('athletes').update({ active_shoe_id: shoe.id }).eq('id', athleteId);
    }

    return NextResponse.json({ shoe });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PATCH /api/shoes  { id, athleteId, name?, distanceLimitKm?, alertBeforeKm?, retired?, setActive? }
 * `athleteId` scopes every write to the caller's own shoes — never a
 * client-supplied shoe id alone. Raising the limit past an already-fired
 * alert resets that alert so it can fire again once actually crossed.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id, athleteId } = body;
    if (!id || !athleteId) return NextResponse.json({ error: 'id and athleteId required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: existing, error: fetchError } = await supabase
      .from('shoes')
      .select('*')
      .eq('id', id)
      .eq('athlete_id', athleteId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return NextResponse.json({ error: 'Shoe not found' }, { status: 404 });

    const update: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      const trimmed = body.name.trim();
      if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      if (trimmed.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `Name is too long (max ${MAX_NAME_LENGTH})` }, { status: 400 });
      }
      update.name = trimmed;
    }
    if (body.distanceLimitKm !== undefined) {
      const nextLimit = body.distanceLimitKm != null ? Number(body.distanceLimitKm) : null;
      update.distance_limit_km = nextLimit;
      if (nextLimit != null && (existing.distance_limit_km == null || nextLimit > existing.distance_limit_km)) {
        update.alerted_near_at = null;
        update.alerted_over_at = null;
      }
    }
    if (body.alertBeforeKm !== undefined) {
      update.alert_before_km = Number(body.alertBeforeKm) || 50;
    }
    if (typeof body.retired === 'boolean') {
      update.retired = body.retired;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('shoes').update(update).eq('id', id);
      if (error) throw error;
    }

    if (body.setActive === true) {
      const { error } = await supabase.from('athletes').update({ active_shoe_id: id }).eq('id', athleteId);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/shoes?id=…&athleteId=…
 * Past activities keep their shoe_id set to NULL (ON DELETE SET NULL) rather
 * than losing the run itself. Clears active_shoe_id if this was the active pair.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const athleteId = searchParams.get('athleteId');
    if (!id || !athleteId) return NextResponse.json({ error: 'id and athleteId required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: athlete } = await supabase.from('athletes').select('active_shoe_id').eq('id', athleteId).maybeSingle();
    if (athlete?.active_shoe_id === id) {
      await supabase.from('athletes').update({ active_shoe_id: null }).eq('id', athleteId);
    }

    const { error } = await supabase.from('shoes').delete().eq('id', id).eq('athlete_id', athleteId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
