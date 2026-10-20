import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { phoneAppState } from '@/lib/onboarding/phone-app';
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
  const { data, error } = await db.from('athletes')
    .select(`created_at, garmin_auth, strava_auth, birth_date, shoe_size, ${kit}, height_cm, weight_kg, notification_prefs`)
    .eq('id', caller.athleteId).maybeSingle();
  if (error || !data) return NextResponse.json({ applicable: false });
  const row = data as unknown as Record<string, unknown>;
  const fresh = SETUP_GATE_FOR_ALL && String(row.created_at || '') >= SETUP_GATE_SINCE;
  if (!fresh && !preview) return NextResponse.json({ applicable: false });

  const { count } = await db.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('athlete_id', caller.athleteId);
  const phoneApp = await phoneAppState(caller.athleteId, count ?? 0, new URL(request.url).origin);
  const setup = ((row.notification_prefs as Record<string, unknown> | null)?.setup || {}) as { noWatch?: boolean };
  return NextResponse.json({
    applicable: true,
    preview,
    phoneOpened: phoneApp.opened,
    connected: !!row.garmin_auth || !!row.strava_auth,
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
 * PATCH /api/setup  { noWatch: boolean } — "I have no watch" passes the watch step. Kept
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
