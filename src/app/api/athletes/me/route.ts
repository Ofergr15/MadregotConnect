import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

const GENDERS = ['male', 'female'] as const;
type Gender = (typeof GENDERS)[number];
const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
type ShirtSize = (typeof SHIRT_SIZES)[number];

// shirt_size/phone (migration 061) may not be applied yet in every environment
// — degrade to the pre-061 column set instead of 404ing the whole route on a
// missing-column error (same "not migrated yet" tolerance as
// notification-prefs' 42703 check, just done as a retry here since this
// route's own shape doesn't have a dedicated 501 path).
const CORE_COLUMNS = 'id, name, email, garmin_auth, strava_auth, data_source, onboarding_status, avatar_url, created_at, birth_date, gender, shoe_size';
const FULL_COLUMNS = `${CORE_COLUMNS}, shirt_size, phone, discoverable`;

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
    ({ data, error } = await supabase.from('athletes').select(CORE_COLUMNS).eq('id', id).single());
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
      data_source: data.data_source || null,
      onboardingStatus: data.onboarding_status,
      avatarUrl: data.avatar_url || null,
      memberSince: data.created_at || null,
      birthDate: (data as any).birth_date || null,
      gender: (data as any).gender || null,
      shoeSize: (data as any).shoe_size || null,
      shirtSize: (data as any).shirt_size || null,
      phone: (data as any).phone || null,
      discoverable: (data as any).discoverable ?? true,
    },
  });
}

// PUT /api/athletes/me { id, name, birthDate, gender, shoeSize, shirtSize, phone }
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
    const { id, name, birthDate, gender, shoeSize, shirtSize, phone, discoverable } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(req, id);
    if (denied) return denied;

    if (gender !== undefined && gender !== null && !GENDERS.includes(gender)) {
      return NextResponse.json({ error: "gender must be 'male' or 'female'" }, { status: 400 });
    }
    if (shirtSize !== undefined && shirtSize !== null && !SHIRT_SIZES.includes(shirtSize)) {
      return NextResponse.json({ error: `shirtSize must be one of ${SHIRT_SIZES.join(', ')}` }, { status: 400 });
    }
    if (name !== undefined && !String(name).trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }

    const updates: Record<string, string | boolean | Gender | ShirtSize | null> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (birthDate !== undefined) updates.birth_date = birthDate || null;
    if (gender !== undefined) updates.gender = gender || null;
    if (shoeSize !== undefined) updates.shoe_size = (shoeSize && String(shoeSize).trim()) || null;
    if (shirtSize !== undefined) updates.shirt_size = shirtSize || null;
    if (phone !== undefined) updates.phone = (phone && String(phone).trim()) || null;
    if (discoverable !== undefined) updates.discoverable = !!discoverable;

    const supabase = createServerClient();
    let { data, error } = await supabase.from('athletes').update(updates).eq('id', id).select(FULL_COLUMNS).single();
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      // shirt_size/phone/discoverable not migrated yet — drop them from both
      // the write and the re-select rather than losing the whole update
      // (name/birthDate/etc still need to save even if the newest columns
      // aren't there yet).
      const { shirt_size, phone: _phone, discoverable: _discoverable, ...coreUpdates } = updates as Record<string, unknown>;
      ({ data, error } = await supabase.from('athletes').update(coreUpdates).eq('id', id).select(CORE_COLUMNS).single());
    }

    if (error || !data) throw error || new Error('Update returned no row');

    return NextResponse.json({
      athlete: {
        id: data.id,
        name: data.name,
        birthDate: (data as any).birth_date || null,
        gender: (data as any).gender || null,
        shoeSize: (data as any).shoe_size || null,
        shirtSize: (data as any).shirt_size || null,
        phone: (data as any).phone || null,
        discoverable: (data as any).discoverable ?? true,
      },
    });
  } catch (error) {
    console.error('Failed to update personal info:', error);
    return NextResponse.json({ error: 'Failed to update personal info' }, { status: 500 });
  }
}
