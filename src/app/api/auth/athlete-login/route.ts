import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: athlete, error } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status')
      .eq('email', email.toLowerCase())
      .eq('status', 'active')
      .single();

    if (error || !athlete) {
      return NextResponse.json(
        { error: 'No active account found with this email. Make sure you joined via your invite link first.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ athlete });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
