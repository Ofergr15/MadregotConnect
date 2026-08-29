import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, signDeviceToken } from '@/lib/auth/device-token';

// Best-effort throttle: this is a single shared password checked with a
// plain !==, with no rate limiting at all before this. Module-scope state
// resets on a cold start, so it's not a hard guarantee on Vercel's
// serverless runtime — but a warm instance handles many consecutive
// requests, which is exactly what a naive brute-force script would produce.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attemptsByEmail = new Map<string, { count: number; windowStart: number }>();

function isThrottled(email: string): boolean {
  const now = Date.now();
  const entry = attemptsByEmail.get(email);
  if (!entry || now - entry.windowStart > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(email: string): void {
  const now = Date.now();
  const entry = attemptsByEmail.get(email);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attemptsByEmail.set(email, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase();
    if (isThrottled(normalizedEmail)) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ error: 'Admin login not configured' }, { status: 500 });
    }

    if (password !== adminPassword) {
      recordFailedAttempt(normalizedEmail);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    attemptsByEmail.delete(normalizedEmail);

    // Verify user exists and has admin/coach role
    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, email, name, role, group_id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (athlete.role !== 'admin' && athlete.role !== 'coach') {
      return NextResponse.json({ error: 'Not authorized as admin' }, { status: 403 });
    }

    // Mint a real Supabase session for this staff account.
    //
    // This login used to hand back nothing but a flag the client wrote to
    // localStorage as `admin_session`, which meant "staff" existed in the
    // browser but not on the server: every route gated by requireSession
    // (/api/plans, POST /api/program-weeks) rejected this login path while the
    // UI still rendered its buttons. Same machinery as the Strava callback.
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const authResult = await createSyntheticSession(authClient, athlete.email!.toLowerCase(), {
      athlete_id: athlete.id,
      name: athlete.name,
    });
    if (authResult.error || !authResult.session) {
      console.error('admin login session mint failed:', authResult.error);
      return NextResponse.json({ error: 'Could not establish session' }, { status: 500 });
    }

    const response = NextResponse.json({
      success: true,
      email: athlete.email,
      name: athlete.name,
      role: athlete.role,
      athleteId: athlete.id,
      groupId: athlete.group_id,
      session: authResult.session,
    });

    const deviceToken = signDeviceToken(athlete.email!);
    if (deviceToken) response.cookies.set(DEVICE_COOKIE, deviceToken, DEVICE_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
