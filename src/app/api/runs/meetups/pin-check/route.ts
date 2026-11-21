import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { homeProximityWarning } from '@/lib/runs/together';
import { hostStarts } from '@/lib/runs/together-server';

export const dynamic = 'force-dynamic';

// POST /api/runs/meetups/pin-check { lat, lng } → { homeWarning: boolean }
// The CALLER's own recent run starts decide it, and only a boolean comes back — the
// frequent-start point itself is never returned (it is, most of the time, a home).
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const { lat, lng } = (await request.json().catch(() => ({}))) as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  const starts = await hostStarts(createServerClient(), auth.user.athleteId, israelToday());
  return NextResponse.json({ homeWarning: homeProximityWarning({ lat, lng }, starts) });
}
