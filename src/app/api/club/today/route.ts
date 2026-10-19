import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';

export const dynamic = 'force-dynamic';

// The runner's home (Ofer, 2026-10-19, mockups/morning-1019/home-v4):
//
// GET -> {
//   runners, km, top: [{ id, name, avatarUrl, km, activityId }]    the club TODAY
//   pack: { name, rank, size, lastRank, gapToFirst, rows: [{ id, name, avatarUrl, km, me }] } | null
// }                                                                 the caller's pack THIS PLAN WEEK
//
// Members only. Active members only, as the feed shows them. Activity times are the
// athlete's wall clock (Convention A, lib/utils.ts), so a day is its date string in Israel;
// the pack's week is the plan's Sunday week, the same window as "השבוע שלי", and last
// week's full total gives the movement ("עלית ממקום 4"). `activityId` is the runner's
// longest run today, which the 👏 on the card goes to.

type Act = { id: string; athlete_id: string; distance: number; duration: number; activity_type: string | null; start_time: string };
type Ath = { id: string; name: string | null; avatar_url: string | null; group_id: string | null };

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const supabase = createServerClient({ revalidateSeconds: 60 });
    const today = israelToday();
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const sunday = addDaysToDateStr(today, -dow);
    const lastSunday = addDaysToDateStr(sunday, -7);
    const [{ data: acts }, { data: athletes }, { data: groups }] = await Promise.all([
      supabase
        .from('athlete_activities')
        .select('id, athlete_id, distance, duration, activity_type, start_time')
        .gte('start_time', `${lastSunday}T00:00:00`)
        .lt('start_time', `${addDaysToDateStr(today, 1)}T00:00:00`)
        .limit(5000),
      supabase.from('athletes').select('id, name, avatar_url, group_id').eq('coach_id', COACH_ID).eq('status', 'active'),
      supabase.from('groups').select('id, name'),
    ]);
    const member = new Map(((athletes || []) as Ath[]).map((a) => [a.id, a]));
    const runs = filterQualifyingRuns((acts || []) as Act[]).filter((a) => member.has(a.athlete_id));

    // ── The club today ──
    const todayKm = new Map<string, number>();
    const longest = new Map<string, { id: string; km: number }>();
    for (const a of runs) {
      if (!a.start_time.startsWith(today)) continue;
      const k = a.distance / 1000;
      todayKm.set(a.athlete_id, (todayKm.get(a.athlete_id) ?? 0) + k);
      if (!longest.has(a.athlete_id) || longest.get(a.athlete_id)!.km < k) longest.set(a.athlete_id, { id: a.id, km: k });
    }
    const km = [...todayKm.values()].reduce((s, x) => s + x, 0);
    const top = [...todayKm.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 7)
      .map(([id, k]) => ({ id, name: member.get(id)?.name || '', avatarUrl: member.get(id)?.avatar_url || null, km: r1(k), activityId: longest.get(id)?.id ?? null }));

    // ── My pack this plan week ──
    let pack = null;
    const me = caller.athleteId ? member.get(caller.athleteId) : undefined;
    if (me?.group_id) {
      const mates = [...member.values()].filter((a) => a.group_id === me.group_id);
      const ids = new Set(mates.map((a) => a.id));
      const thisWeek = new Map(mates.map((a) => [a.id, 0]));
      const lastWeek = new Map(mates.map((a) => [a.id, 0]));
      for (const a of runs) {
        if (!ids.has(a.athlete_id)) continue;
        const day = a.start_time.slice(0, 10);
        const target = day >= sunday ? thisWeek : lastWeek;
        target.set(a.athlete_id, (target.get(a.athlete_id) ?? 0) + a.distance / 1000);
      }
      const order = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
      const now = order(thisWeek);
      const before = order(lastWeek);
      const rank = now.indexOf(me.id) + 1;
      const firstKm = thisWeek.get(now[0]) ?? 0;
      const rowIds = now.slice(0, 3).includes(me.id) ? now.slice(0, 3) : [...now.slice(0, 2), me.id];
      pack = {
        name: (groups || []).find((g: { id: string; name: string | null }) => g.id === me.group_id)?.name || '',
        rank,
        size: now.length,
        lastRank: (lastWeek.get(me.id) ?? 0) > 0 ? before.indexOf(me.id) + 1 : null,
        gapToFirst: rank === 1 ? 0 : r1(firstKm - (thisWeek.get(me.id) ?? 0)),
        rows: rowIds.map((id) => ({
          id, name: member.get(id)?.name || '', avatarUrl: member.get(id)?.avatar_url || null,
          km: r1(thisWeek.get(id) ?? 0), rank: now.indexOf(id) + 1, me: id === me.id,
        })),
      };
    }

    return NextResponse.json({ runners: todayKm.size, km: Math.round(km), top, pack });
  } catch (err) {
    console.error('[club/today] failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}
