import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';

export const dynamic = 'force-dynamic';

// "במועדון היום" on the runner's home (Ofer, 2026-10-19, mockups/morning-1019): how many
// of the club ran today, the kilometres together, and the ones who ran furthest.
//
// GET -> { runners, km, top: [{ id, name, avatarUrl, km }] }   members only.
//
// Active members only, as the feed shows them; activity times are the athlete's wall
// clock (Convention A, lib/utils.ts), so today is today's date string in Israel.
export async function GET(request: Request) {
  const { denied } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const supabase = createServerClient({ revalidateSeconds: 120 });
    const today = israelToday();
    const [{ data: acts }, { data: athletes }] = await Promise.all([
      supabase
        .from('athlete_activities')
        .select('athlete_id, distance, duration, activity_type, start_time')
        .gte('start_time', `${today}T00:00:00`)
        .lt('start_time', `${addDaysToDateStr(today, 1)}T00:00:00`)
        .limit(2000),
      supabase.from('athletes').select('id, name, avatar_url').eq('coach_id', COACH_ID).eq('status', 'active'),
    ]);
    const member = new Map((athletes || []).map((a: { id: string; name: string | null; avatar_url: string | null }) => [a.id, a]));
    const byAthlete = new Map<string, number>();
    for (const a of filterQualifyingRuns((acts || []) as Array<{ athlete_id: string; distance: number; duration: number; activity_type: string | null; start_time: string }>)) {
      if (!member.has(a.athlete_id)) continue;
      byAthlete.set(a.athlete_id, (byAthlete.get(a.athlete_id) ?? 0) + a.distance / 1000);
    }
    const km = [...byAthlete.values()].reduce((s, x) => s + x, 0);
    const top = [...byAthlete.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 7)
      .map(([id, k]) => ({ id, name: member.get(id)?.name || '', avatarUrl: member.get(id)?.avatar_url || null, km: Math.round(k * 10) / 10 }));
    return NextResponse.json({ runners: byAthlete.size, km: Math.round(km), top });
  } catch (err) {
    console.error('[club/today] failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}
