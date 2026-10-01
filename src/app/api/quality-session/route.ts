import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { loadQualitySession } from '@/lib/quality-session/server';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/quality-session?date=YYYY-MM-DD
//   -> { date, label, workout, runs } — is it a quality day (workout null when
//      not), and every run of that day with its pack and its reps.
//
// Super user only, decided on the VERIFIED session, like /api/pack-stories: it
// lists every runner's name and laps for the day, and is still being tried out.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });

  try {
    return NextResponse.json(await loadQualitySession(createServerClient(), date));
  } catch (err) {
    console.error('[quality-session] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load the session' }, { status: 500 });
  }
}
