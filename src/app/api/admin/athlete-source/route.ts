import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function PATCH(request: Request) {
  try {
    const { athleteId, dataSource } = await request.json();

    if (!athleteId || !['garmin', 'strava'].includes(dataSource)) {
      return NextResponse.json({ error: 'athleteId and valid dataSource (garmin|strava) required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase
      .from('athletes')
      .update({ data_source: dataSource })
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
    const { data, error } = await supabase
      .from('athletes')
      .select('id, name, data_source, strava_auth, garmin_auth')
      .order('name');

    if (error) throw error;

    const athletes = (data || []).map(a => ({
      id: a.id,
      name: a.name,
      dataSource: a.data_source || 'garmin',
      hasGarmin: !!a.garmin_auth,
      hasStrava: !!a.strava_auth,
    }));

    return NextResponse.json({ athletes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
