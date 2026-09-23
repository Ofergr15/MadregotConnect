import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { readWellnessNights } from '@/lib/wellness/read';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wellness?days=8 — the caller's OWN nights (sleep + resting HR, #69).
 * Self only: the athlete comes off the session, never the query string.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const athleteId = auth.user.athleteId;
  if (!athleteId) return NextResponse.json({ nights: [] });

  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 8, 1), 31);
  return NextResponse.json({ nights: await readWellnessNights(createServerClient(), athleteId, days) });
}
