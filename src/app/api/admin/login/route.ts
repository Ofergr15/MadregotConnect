import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ error: 'Admin login not configured' }, { status: 500 });
    }

    if (password !== adminPassword) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Verify user exists and has admin/coach role
    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, email, name, role')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (athlete.role !== 'admin' && athlete.role !== 'coach') {
      return NextResponse.json({ error: 'Not authorized as admin' }, { status: 403 });
    }

    return NextResponse.json({ success: true, email: athlete.email, name: athlete.name, role: athlete.role });
  } catch (error) {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
