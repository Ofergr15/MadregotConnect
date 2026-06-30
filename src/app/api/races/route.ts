import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('races')
      .select('*')
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ races: data || [] });
  } catch (error) {
    console.error('Failed to fetch races:', error);
    return NextResponse.json({ error: 'Failed to fetch races' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { name, date, location, lat, lng, distances, type, website } = body;

    if (!name || !date || !location || !lat || !lng) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('races')
      .insert({ name, date, location, lat, lng, distances: distances || [], type: type || 'half', website })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ race: data });
  } catch (error) {
    console.error('Failed to create race:', error);
    return NextResponse.json({ error: 'Failed to create race' }, { status: 500 });
  }
}
