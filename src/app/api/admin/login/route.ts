import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

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

    return NextResponse.json({
      success: true,
      email: athlete.email,
      name: athlete.name,
      role: athlete.role,
      athleteId: athlete.id,
      groupId: athlete.group_id,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
