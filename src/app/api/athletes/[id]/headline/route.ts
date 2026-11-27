import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hiddenFromCaller } from '@/lib/athletes/test-accounts';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { buildProfileHeadline, cachedHeadline } from '@/lib/athletes/profile-headline';
import type { RunActivityRow } from '@/lib/prs/pr-buckets';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/athletes/[id]/headline → { weekStart, weekKm, weekRuns, monthKm, monthRuns, yearKm, yearRuns, streakWeeks }
 *
 * The profile's headline numbers in one small cached response (night task 60), so the
 * header can paint before the full /stats payload. Same audience as /stats: any verified
 * club member (a leaderboard already shows teammates' weekly km), except a runner the club
 * hasn't approved yet, who is visible to themselves and staff only (404 otherwise).
 *
 * Cached per athlete for 60 s server-side (lib/athletes/profile-headline). The visibility
 * check runs on every request, before the cache. Only this year's activities are read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const db = createServerClient();
    if (await hiddenFromCaller(db, caller, id)) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });

    const { value, hit } = await cachedHeadline(id, async () => {
      // From the earlier of Jan 1 and 6 months back: covers the year totals, and the
      // streak is counted within that window (at least ~26 weeks of history).
      const now = new Date();
      const jan1 = `${now.getUTCFullYear()}-01-01`;
      const sixMonths = new Date(now.getTime() - 183 * 86400_000).toISOString().slice(0, 10);
      const since = jan1 < sixMonths ? jan1 : sixMonths;
      const acts = await fetchAllRows<RunActivityRow>((from, to) => db.from('athlete_activities')
        .select('id, activity_type, start_time, distance, duration')
        .eq('athlete_id', id)
        .gte('start_time', since)
        .order('start_time', { ascending: false })
        .order('id')
        .range(from, to));
      return buildProfileHeadline(acts, now);
    });
    return NextResponse.json(value, { headers: { 'Cache-Control': 'private, no-store', 'X-Cache': hit ? 'hit' : 'miss' } });
  } catch (err: unknown) {
    console.error('GET /api/athletes/[id]/headline error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
