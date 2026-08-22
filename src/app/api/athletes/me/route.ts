import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const GENDERS = ['male', 'female'] as const;
type Gender = (typeof GENDERS)[number];

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, email, garmin_auth, strava_auth, data_source, onboarding_status, avatar_url, created_at, birth_date, gender, shoe_size')
    .eq('id', id)
    .single();

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
    },
  });
}

// PUT /api/athletes/me { id, name, birthDate, gender, shoeSize }
// Owner-only: `id` is the caller's own athlete id (stored in localStorage) —
// same trust model as PUT /api/athletes/notification-prefs. Every field is
// optional so the Settings > Personal Info form can save a partial edit.
// `name` is the one field that isn't purely personal-info — it's shown
// everywhere (headers, feed, leaderboards), so it's trimmed and required to
// be non-empty when present (an athlete can't blank out their own name).
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, birthDate, gender, shoeSize } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (gender !== undefined && gender !== null && !GENDERS.includes(gender)) {
      return NextResponse.json({ error: "gender must be 'male' or 'female'" }, { status: 400 });
    }
    if (name !== undefined && !String(name).trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }

    const updates: Record<string, string | Gender | null> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (birthDate !== undefined) updates.birth_date = birthDate || null;
    if (gender !== undefined) updates.gender = gender || null;
    if (shoeSize !== undefined) updates.shoe_size = (shoeSize && String(shoeSize).trim()) || null;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', id)
      .select('id, name, birth_date, gender, shoe_size')
      .single();

    if (error) throw error;

    return NextResponse.json({
      athlete: {
        id: data.id,
        name: data.name,
        birthDate: (data as any).birth_date || null,
        gender: (data as any).gender || null,
        shoeSize: (data as any).shoe_size || null,
      },
    });
  } catch (error) {
    console.error('Failed to update personal info:', error);
    return NextResponse.json({ error: 'Failed to update personal info' }, { status: 500 });
  }
}
