import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { KIT_SIZE_FIELDS } from '@/lib/kit-sizes';
import { PROVIDER_HEALTH_COLUMNS_101, connectionState } from '@/lib/providers/health';

const GENDERS = ['male', 'female'] as const;
type Gender = (typeof GENDERS)[number];

// shirt_size/phone (migration 061) may not be applied yet in every environment
// — degrade to the pre-061 column set instead of 404ing the whole route on a
// missing-column error (same "not migrated yet" tolerance as
// notification-prefs' 42703 check, just done as a retry here since this
// route's own shape doesn't have a dedicated 501 path).
// strava_enabled joins strava_auth/data_source here (all three landed together in
// migration 013) so one call can answer the whole "which watch is this athlete on"
// question. /dashboard/profile used to get that from GET /api/admin/athlete-source,
// which returns EVERY athlete's row — a whole-roster download to read four fields
// about yourself, on a screen an athlete opens constantly.
const CORE_COLUMNS = 'id, name, email, garmin_auth, strava_auth, strava_enabled, data_source, onboarding_status, avatar_url, created_at, birth_date, gender, shoe_size';
// The three non-shirt kit sizes (migration 100) ride the SAME degrade path: they
// are the newest columns here, so until 100 is pasted in they trip the 42703 /
// PGRST204 retry below and the route serves the pre-100 set instead of 404ing.
const PRE_100_COLUMNS = `${CORE_COLUMNS}, shirt_size, phone, discoverable`;
const PRE_101_COLUMNS = `${PRE_100_COLUMNS}, pants_size, tights_size, socks_size`;
// Migration 101's connection-health timestamps are now the newest columns here, so
// they take the first step of the degrade path — see the retry in GET.
const FULL_COLUMNS = `${PRE_101_COLUMNS}, ${PROVIDER_HEALTH_COLUMNS_101}`;

/** `{ shirtSize: 'L', pantsSize: null, … }` from whichever columns the row carries. */
function kitSizesOf(row: Record<string, unknown>) {
  return Object.fromEntries(
    KIT_SIZE_FIELDS.map(k => [k.field, (row[k.column] as string) || null]),
  ) as Record<string, string | null>;
}

// GET /api/athletes/me?id=…
// Self-or-staff: this projection carries the athlete's email, phone and
// onboarding/provider state, so it isn't the public one (see
// src/lib/athletes/public-profile.ts). Ungated, `?id=<anyone>` returned any
// club member's contact details to an anonymous caller.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const { denied } = await requireCallerForAthlete(req, id);
  if (denied) return denied;

  const supabase = createServerClient();
  let { data, error } = await supabase.from('athletes').select(FULL_COLUMNS).eq('id', id).single();
  // '42703' = raw Postgres undefined_column; 'PGRST204' = PostgREST's own
  // schema-cache check rejecting an unknown column before SQL is generated
  // — observed for real (not just theoretical) on the discoverable rollout.
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    // Step down one migration at a time — otherwise, in the window before 101 is
    // applied, the profile screen would also stop showing the kit sizes, shirt size
    // and phone it has been showing since 100 and 061.
    ({ data, error } = await supabase.from('athletes').select(PRE_101_COLUMNS).eq('id', id).single());
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      ({ data, error } = await supabase.from('athletes').select(PRE_100_COLUMNS).eq('id', id).single());
      if (error?.code === '42703' || error?.code === 'PGRST204') {
        ({ data, error } = await supabase.from('athletes').select(CORE_COLUMNS).eq('id', id).single());
      }
    }
  }

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    athlete: {
      id: data.id,
      name: data.name,
      email: data.email,
      hasGarmin: !!data.garmin_auth,
      hasStrava: !!data.strava_auth,
      // hasGarmin/hasStrava only say a credential is STORED. These say whether it
      // still works — 'ok' | 'stale' | 'failed' | 'unknown' | 'none'. Kept beside
      // the booleans rather than replacing them because the connect buttons, the
      // source switch and the setup checklist all key off "is one stored".
      garminState: connectionState({
        hasAuth: !!data.garmin_auth,
        lastSyncAt: (data as any).garmin_last_sync_at,
        authFailedAt: (data as any).garmin_auth_failed_at,
      }),
      garminLastSyncAt: (data as any).garmin_last_sync_at || null,
      stravaState: connectionState({
        hasAuth: !!data.strava_auth,
        lastSyncAt: (data as any).strava_last_sync_at,
        authFailedAt: (data as any).strava_auth_failed_at,
      }),
      stravaLastSyncAt: (data as any).strava_last_sync_at || null,
      // Same OR as /api/admin/athlete-source: a connected Strava account counts as
      // enabled even on a row that predates the flag.
      stravaEnabled: !!(data as any).strava_enabled || !!data.strava_auth,
      data_source: data.data_source || null,
      onboardingStatus: data.onboarding_status,
      avatarUrl: data.avatar_url || null,
      memberSince: data.created_at || null,
      birthDate: (data as any).birth_date || null,
      gender: (data as any).gender || null,
      shoeSize: (data as any).shoe_size || null,
      ...kitSizesOf(data as unknown as Record<string, unknown>),
      phone: (data as any).phone || null,
      discoverable: (data as any).discoverable ?? true,
    },
  });
}

// PUT /api/athletes/me { id, name, birthDate, gender, shoeSize, shirtSize,
//                        pantsSize, tightsSize, socksSize, phone, discoverable }
// Self-or-staff on `id` — the athlete themself from their profile screen, or
// staff editing a member from Settings > Personal Info. `id` used to be taken
// on trust from localStorage, which let anyone rewrite any athlete's name.
// Every field is optional so the form can save a partial edit.
// `name` is the one field that isn't purely personal-info — it's shown
// everywhere (headers, feed, leaderboards), so it's trimmed and required to
// be non-empty when present (an athlete can't blank out their own name).
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, birthDate, gender, shoeSize, phone, discoverable } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(req, id);
    if (denied) return denied;

    if (gender !== undefined && gender !== null && !GENDERS.includes(gender)) {
      return NextResponse.json({ error: "gender must be 'male' or 'female'" }, { status: 400 });
    }
    // Validated off KIT_SIZE_FIELDS rather than four hand-written checks: these
    // lists are also a CHECK constraint, so an unvalidated value is not a 400 but a
    // 500 from the database. Socks use a different list from the garments, which is
    // exactly the mistake a copy-pasted check makes.
    for (const { field, options } of KIT_SIZE_FIELDS) {
      const v = body[field];
      if (v !== undefined && v !== null && v !== '' && !(options as readonly string[]).includes(v)) {
        return NextResponse.json({ error: `${field} must be one of ${options.join(', ')}` }, { status: 400 });
      }
    }
    if (name !== undefined && !String(name).trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }

    const updates: Record<string, string | boolean | Gender | null> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (birthDate !== undefined) updates.birth_date = birthDate || null;
    if (gender !== undefined) updates.gender = gender || null;
    if (shoeSize !== undefined) updates.shoe_size = (shoeSize && String(shoeSize).trim()) || null;
    for (const { field, column } of KIT_SIZE_FIELDS) {
      if (body[field] !== undefined) updates[column] = body[field] || null;
    }
    if (phone !== undefined) updates.phone = (phone && String(phone).trim()) || null;
    if (discoverable !== undefined) updates.discoverable = !!discoverable;

    const missingColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';
    const supabase = createServerClient();
    // PRE_101, not FULL: this handler neither writes nor returns the connection
    // health timestamps, so naming them here would only add a fourth way for a
    // personal-info save to fail on a column it doesn't care about.
    let { data, error } = await supabase.from('athletes').update(updates).eq('id', id).select(PRE_101_COLUMNS).single();
    if (missingColumn(error)) {
      // ── Two steps down, not one ───────────────────────────────────────────────
      // The newest columns are 100's three kit sizes, and there is a window between
      // this deploy and 100 being pasted into the SQL editor. Dropping straight to
      // CORE (as this did when 061 was the newest) would silently throw away a
      // shirt_size save for the whole of that window — the sheet would close, say
      // nothing, and the size would be gone. So: try without 100 first, and only
      // fall all the way back to pre-061 if THAT still fails.
      const { pants_size, tights_size, socks_size, ...pre100 } = updates as Record<string, unknown>;
      ({ data, error } = await supabase.from('athletes').update(pre100).eq('id', id).select(PRE_100_COLUMNS).single());
      if (missingColumn(error)) {
        const { shirt_size, phone: _phone, discoverable: _discoverable, ...coreUpdates } = pre100;
        ({ data, error } = await supabase.from('athletes').update(coreUpdates).eq('id', id).select(CORE_COLUMNS).single());
      }
    }

    if (error || !data) throw error || new Error('Update returned no row');

    return NextResponse.json({
      athlete: {
        id: data.id,
        name: data.name,
        birthDate: (data as any).birth_date || null,
        gender: (data as any).gender || null,
        shoeSize: (data as any).shoe_size || null,
        ...kitSizesOf(data as unknown as Record<string, unknown>),
        phone: (data as any).phone || null,
        discoverable: (data as any).discoverable ?? true,
      },
    });
  } catch (error) {
    console.error('Failed to update personal info:', error);
    return NextResponse.json({ error: 'Failed to update personal info' }, { status: 500 });
  }
}
