import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function PATCH(request: Request) {
  try {
    const { athleteId, dataSource, stravaEnabled } = await request.json();

    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
