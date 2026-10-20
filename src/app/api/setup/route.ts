import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { KIT_SIZE_FIELDS } from '@/lib/kit-sizes';
import { SETUP_GATE_FOR_ALL, SETUP_GATE_SINCE } from '@/lib/setup/flag';

export const dynamic = 'force-dynamic';

/**
 * GET /api/setup[?preview=1] — what the required setup (components/setup/SetupGate) still
 * needs from the caller. Self only. `applicable` is false for the admin account, for
 * members who joined before SETUP_GATE_SINCE (they keep the feed's checklist) and while
 * the switch is off — except the super user's `?preview=1`, which sees it as a newcomer.
 * The device half (installed? a phone?) is the client's to add: only it knows.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId || (hasRole(caller, 'admin') && !caller.isSuperUser)) return NextResponse.json({ applicable: false });
  const preview = caller.isSuperUser && new URL(request.url).searchParams.get('preview') === '1';
  const db = createServerClient();
  const kit = KIT_SIZE_FIELDS.map((k) => k.column).join(', ');
  // One wave: the row and the push count together (this runs on every screen — the gate
  // and lib/setup/use-cohort both ask). `garmin_auth:has_garmin` reads the presence
  // column (migration 165), not the encrypted credential.
  const [{ data, error }, { count }] = await Promise.all([
    db.from('athletes')
      .select(`created_at, garmin_auth:has_garmin, strava_auth:has_strava, birth_date, shoe_size, ${kit}, height_cm, weight_kg, notification_prefs`)
      .eq('id', caller.athleteId).maybeSingle(),
    db.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('athlete_id', caller.athleteId),
  ]);
  if (error || !data) return NextResponse.json({ applicable: false });
  const row = data as unknown as Record<string, unknown>;
  const fresh = SETUP_GATE_FOR_ALL && String(row.created_at || '') >= SETUP_GATE_SINCE;
  if (!fresh && !preview) return NextResponse.json({ applicable: false });

  const setup = ((row.notification_prefs as Record<string, unknown> | null)?.setup || {}) as { noWatch?: boolean };
  return NextResponse.json({
    applicable: true,
    preview,
    garmin: !!row.garmin_auth,
    strava: !!row.strava_auth,
    noWatch: setup.noWatch === true,
    push: (count ?? 0) > 0,
    birthDate: (row.birth_date as string) || null,
    heightCm: row.height_cm == null ? null : Number(row.height_cm),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    sizes: {
      shoeSize: (row.shoe_size as string) || null,
      ...Object.fromEntries(KIT_SIZE_FIELDS.map((k) => [k.field, (row[k.column] as string) || null])),
    },
  });
}

/**
 * PATCH /api/setup  { noWatch: boolean } — "I have no Garmin" passes the watch step. Kept
 * in notification_prefs.setup, merged so every other key there stays as it was.
 */
export async function PATCH(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { noWatch?: unknown };
  if (typeof body.noWatch !== 'boolean') return NextResponse.json({ error: 'noWatch must be true or false' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', caller.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const prefs = ((data?.notification_prefs as Record<string, unknown> | null) || {});
  const setup = { ...((prefs.setup as Record<string, unknown>) || {}), noWatch: body.noWatch };
  const { error: upErr } = await db.from('athletes').update({ notification_prefs: { ...prefs, setup } }).eq('id', caller.athleteId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, noWatch: body.noWatch });
}
