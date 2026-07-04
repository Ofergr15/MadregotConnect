import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, email, garmin_auth, onboarding_status')
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
      onboardingStatus: data.onboarding_status,
    },
  });
}
