import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireMember } from '@/lib/auth/self-or-staff';
import { rethrowIfDynamicBailout } from '@/lib/dynamic-bailout';
import { resolveGroup, getActivityWeekStart, israelDateAnchor } from '@/lib/utils';

// Weekly squad rivalry, rolled up — a few minutes of staleness is invisible
// against a week-long window, so this participates in Next's Data Cache
// instead of forcing dynamic rendering on every request. See
// src/lib/supabase/server.ts for how `revalidateSeconds` maps to the
// underlying fetch's cache behavior.
export const revalidate = 300;

// GET /api/groups/standings
// דבוקה squad rivalry — THIS WEEK (rolling Monday→now) squad-vs-squad standings.
// Every metric is PER ACTIVE MEMBER so squad size never decides the ranking:
//  - volumeKmPerMember : week running distance ÷ active members
//  - attendancePerMember: week practice-attendances (attending=true) ÷ members
//  - consistencyPct     : % of members with ≥1 run this week
// Ranked by a normalized blended score (each metric scaled 0..1 vs the best
// squad, equally weighted).
//
// It was monthly (rolling 1st→now) until 2026-09-16, and reported as broken for
// it: "הקילומטרים בתחרות בין הקבוצות לא מתאפסים בין שבוע לשבוע". Nothing was
// wrong with the arithmetic — a contest whose leader is decided by what happened
// three weeks ago just isn't read as a contest, and the card sat on the feed
// beside a weekly leaderboard. So the window is the ACTIVITY week (Monday, what
// watches report and what `consistencyPct` always used), which also makes all
// three metrics share one window for the first time.
//
// This one really is squad-level only — no names, no ids beyond group_id — so
// the old "public read, no private data" note was honest about the payload. It's
// still member-gated now: it's a per-member breakdown of how hard each squad in
// a private club trains, which isn't ours to publish, and leaving one club
// aggregate open makes "is this route gated?" a per-route question again.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;

    // Same trade as the leaderboard: the route stops being statically
    // prerendered, but revalidateSeconds keeps the queries in the Data Cache.
    const supabase = createServerClient({ revalidateSeconds: 300 });
    const now = israelDateAnchor(); // Israel's calendar day, not the server's UTC one
    const weekStart = getActivityWeekStart(now); // Monday — the one window every metric uses

    // 1) Active athletes with a squad.
    const { data: athletes, error: aErr } = await supabase
      .from('athletes')
      .select('id, group_id, groups(name)')
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');
    if (aErr) throw aErr;

    const withSquad = (athletes || []).filter((a: any) => a.group_id);
    if (withSquad.length === 0) return NextResponse.json({ squads: [] });

    const idToGroup = new Map<string, string>();
    const groupName = new Map<string, string>();
    const members = new Map<string, number>();
    for (const a of withSquad as any[]) {
      idToGroup.set(a.id, a.group_id);
      members.set(a.group_id, (members.get(a.group_id) || 0) + 1);
      if (a.groups?.name) groupName.set(a.group_id, a.groups.name);
    }
    const athleteIds = withSquad.map((a: any) => a.id);

    // 2) This week's activities (runs only), folded per athlete.
    const { data: acts, error: actErr } = await supabase
      .from('athlete_activities')
      .select('athlete_id, activity_type, distance, start_time')
      .in('athlete_id', athleteIds)
      .gte('start_time', weekStart);
    if (actErr) throw actErr;

    const perGroupKm = new Map<string, number>();
    const ranThisWeekByGroup = new Map<string, Set<string>>();
    for (const r of (acts || []) as any[]) {
      if (!(r.distance > 0) || (r.activity_type && !RUN_TYPES.includes(r.activity_type))) continue;
      const g = idToGroup.get(r.athlete_id);
      if (!g) continue;
      perGroupKm.set(g, (perGroupKm.get(g) || 0) + r.distance / 1000);
      // Every row fetched is already inside the week, so this no longer needs the
      // second date test it had while the fetch was monthly.
      const set = ranThisWeekByGroup.get(g) || new Set<string>();
      set.add(r.athlete_id);
      ranThisWeekByGroup.set(g, set);
    }

    // 3) This week's attendance (attending=true). No group_id on the table —
    //    join via athlete. week_start_date is the PLAN week's Sunday while this
    //    window is the ACTIVITY week's Monday, and a row's real date can be up to
    //    +6 days after its week_start_date, so widen the lower bound then trim by
    //    each row's real date. That trim is what keeps the two anchors from
    //    mattering here.
    const today = iso(now);
    const lower = new Date(weekStart + 'T12:00:00');
    lower.setDate(lower.getDate() - 6);
    const { data: att } = await supabase
      .from('workout_attendance')
      .select('athlete_id, attending, week_start_date, day_of_week')
      .gte('week_start_date', iso(lower));
    const perGroupAtt = new Map<string, number>();
    for (const r of (att || []) as any[]) {
      if (!r.attending) continue;
      const g = idToGroup.get(r.athlete_id);
      if (!g) continue;
      const d = new Date(r.week_start_date + 'T12:00:00');
      d.setDate(d.getDate() + Number(r.day_of_week));
      const day = iso(d);
      // Attendance is an RSVP, so rows exist for days that haven't happened yet.
      // Counting them was harmless across a month; in a seven-day contest a squad
      // that ticks Friday would lead on Tuesday for a practice nobody has been to,
      // while km can only ever be what was actually run. Both sides stop at today.
      if (day < weekStart || day > today) continue;
      perGroupAtt.set(g, (perGroupAtt.get(g) || 0) + 1);
    }

    // 4) Per-member metrics + blended score.
    const raw = Array.from(members.entries()).map(([gid, count]) => {
      const rg = resolveGroup(groupName.get(gid));
      return {
        groupId: gid,
        name: rg.displayName,
        color: rg.hex,
        index: rg.index,
        members: count,
        volumeKmPerMember: Math.round(((perGroupKm.get(gid) || 0) / count) * 10) / 10,
        attendancePerMember: Math.round(((perGroupAtt.get(gid) || 0) / count) * 10) / 10,
        consistencyPct: Math.round(((ranThisWeekByGroup.get(gid)?.size || 0) / count) * 100),
      };
    });

    const maxV = Math.max(...raw.map((s) => s.volumeKmPerMember), 0.0001);
    const maxA = Math.max(...raw.map((s) => s.attendancePerMember), 0.0001);
    const squads = raw
      .map((s) => ({
        ...s,
        score: Math.round(
          ((s.volumeKmPerMember / maxV) + (s.attendancePerMember / maxA) + (s.consistencyPct / 100)) / 3 * 1000
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    return NextResponse.json({ squads, weekStart });
  } catch (error: any) {
    rethrowIfDynamicBailout(error);
    console.error('Standings error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
