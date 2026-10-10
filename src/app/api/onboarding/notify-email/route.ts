import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';

export const dynamic = 'force-dynamic';

// POST /api/onboarding/notify-email { email } — "tell me by email when I'm in".
//
// For the member waiting for approval who has no way to be told: they signed in
// with Strava, so the only address on file is the synthetic
// strava_<id>@strava.madregot.local, and an iPhone Safari tab cannot receive a
// push. Everyone like that who waited days for approval was lost (analysis
// 2026-10-10). The address goes on their PENDING signup request (migration 140),
// never onto the athlete row — a real address there would stop requireSession
// matching their Strava login (see the synthetic-email note in lib/auth).
// Read once, by /api/admin/approve, to send the "you're in" mail.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const auth = await requireSession(request);
  // Exempt from the approval gate (lib/auth/approval-gate), so a pending member gets here.
  if (!auth.ok) return authError(auth);
  const athleteId = auth.user.athleteId;
  if (!athleteId) return NextResponse.json({ error: 'no-athlete' }, { status: 400 });
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(clean) || clean.endsWith('.local')) return NextResponse.json({ error: 'bad-email' }, { status: 400 });
  const { data, error } = await createServerClient().from('signup_requests')
    .update({ notify_email: clean })
    .eq('athlete_id', athleteId).eq('status', 'pending')
    .select('id');
  if (error && (error.code === '42703' || error.code === 'PGRST204')) return NextResponse.json({ error: 'not-ready' }, { status: 503 });
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  await recordOnbEvent({ step: 'notify_email_left', athleteId, device: deviceFromUa(request.headers.get('user-agent')) });
  return NextResponse.json({ ok: true, saved: (data ?? []).length > 0 });
}
