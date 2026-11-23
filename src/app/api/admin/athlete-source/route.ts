import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

// Self-or-staff, like PUT /api/athletes: the coach switches any athlete's data
// source from the athletes screen, and an athlete with both watches connected
// switches their own from /dashboard/profile.
export async function PATCH(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    const { athleteId, dataSource, stravaEnabled } = await request.json();

    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    if (!auth.user.isStaff && athleteId !== auth.user.athleteId) {
      return NextResponse.json({ error: 'You can only change your own data source' }, { status: 403 });
    }

    const supabase = createServerClient();
    const update: any = {};

    if (dataSource && ['garmin', 'strava'].includes(dataSource)) {
      update.data_source = dataSource;
    }
    if (stravaEnabled !== undefined) {
      update.strava_enabled = stravaEnabled;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabase
      .from('athletes')
      .update(update)
      .eq('id', athleteId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/admin/athlete-source]', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

// Every athlete's name, data source and which providers they have connected:
// staff only. It had no gate at all; its one member-side reader (the profile
// screen) moved to /api/athletes/me, and no web screen reads it any more.
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  try {
    const supabase = createServerClient();
    let data: any[] | null = null;
    let error: any = null;

    const result = await supabase
      .from('athletes')
      .select('id, name, data_source, strava_auth, strava_enabled, garmin_auth')
      .order('name');

    if (result.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, name, garmin_auth')
        .order('name');
      data = fallback.data;
      error = fallback.error;
    } else {
      data = result.data;
    }

    if (error) throw error;

    const athletes = (data || []).map(a => ({
      id: a.id,
      name: a.name,
      dataSource: (a as any).data_source || 'garmin',
      hasGarmin: !!a.garmin_auth,
      hasStrava: !!(a as any).strava_auth,
      stravaEnabled: !!(a as any).strava_enabled || !!(a as any).strava_auth,
    }));

    return NextResponse.json({ athletes });
  } catch (error: any) {
    console.error('[api/admin/athlete-source]', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
