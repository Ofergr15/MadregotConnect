import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ groups: [] });
    }

    const supabase = createServerClient();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('coach_id')
      .eq('invite_token', token)
      .single();

    if (!athlete) {
      return NextResponse.json({ groups: [] });
    }

    const { data: groups } = await supabase
      .from('groups')
      .select('id, name')
      .eq('coach_id', athlete.coach_id)
      .order('name');

    return NextResponse.json({ groups: groups || [] });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
