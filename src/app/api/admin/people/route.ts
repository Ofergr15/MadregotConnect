import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { REPORT_RUN_TYPES, israelDateOf } from '@/lib/reports/last-7-days';
import type { Person } from '@/lib/admin/people';
import { REMOVED_STATUS } from '@/lib/admin/entry-queue';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/people — the admin's People list and member card (#71 phase 2).
//
// Account health rather than training: approved or waiting, which watch feeds
// the data, when the last run actually arrived, when they last opened the app,
// whether setup was finished, and whether a push can reach them. The member's
// training stays on their own profile, one tap away.
//
// Four reads, all in parallel. The runs read is bounded to 60 days and reduced to
// "latest run day" here; somebody quiet for longer than that reads as "no run in
// 60 days", which is the same answer for an admin.
// ═════════════════════════════════════════════════════════════════════════════

/** Same exclusion as /api/admin/overview: the admin account is not a member. */
const NOT_ADMIN = 'role.is.null,role.neq.admin';
const RUN_WINDOW_DAYS = 60;

interface AthleteRow {
  id: string;
  name: string | null;
  role: string | null;
  group_id: string | null;
  status: string | null;
  approved: boolean | null;
  garmin_auth: unknown;
  strava_auth: unknown;
  last_seen_at: string | null;
  created_at: string | null;
  onboarding_completed_at: string | null;
}

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const since = new Date(Date.now() - RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [athletes, groups, runs, pushes] = await Promise.all([
      // garmin_auth/strava_auth for PRESENCE only, exactly as /api/admin/users
      // reads them: the credentials never leave this function.
      supabase
        .from('athletes')
        .select('id, name, role, group_id, status, approved, garmin_auth, strava_auth, last_seen_at, created_at, onboarding_completed_at')
        .eq('coach_id', COACH_ID)
        .or(NOT_ADMIN)
        .order('name'),
      supabase.from('groups').select('id, name').eq('coach_id', COACH_ID),
      supabase
        .from('athlete_activities')
        .select('athlete_id, start_time')
        .in('activity_type', REPORT_RUN_TYPES)
        .gte('start_time', since)
        .order('start_time', { ascending: false })
        .limit(5000),
      supabase.from('push_subscriptions').select('athlete_id, last_success_at'),
    ]);
    if (athletes.error) throw athletes.error;

    const groupName = new Map(((groups.data || []) as { id: string; name: string }[]).map(g => [g.id, g.name]));

    const lastRun = new Map<string, string>();
    for (const r of (runs.data || []) as { athlete_id: string; start_time: string }[]) {
      const day = israelDateOf(r.start_time);
      const seen = lastRun.get(r.athlete_id);
      if (!seen || day > seen) lastRun.set(r.athlete_id, day);
    }

    const push = new Map<string, { n: number; last: string | null }>();
    for (const s of (pushes.data || []) as { athlete_id: string | null; last_success_at: string | null }[]) {
      if (!s.athlete_id) continue;
      const cur = push.get(s.athlete_id) || { n: 0, last: null };
      cur.n++;
      if (s.last_success_at && (!cur.last || s.last_success_at > cur.last)) cur.last = s.last_success_at;
      push.set(s.athlete_id, cur);
    }

    // Removed members are dropped HERE, not in the query. Prod's athlete_status
    // enum is active | invited | disconnected — `.neq('status', 'removed')`
    // made Postgres reject the whole read (22P02), so the screen was a 500 for
    // everybody. A string compare can't fail that way, and still does the right
    // thing once the enum gains the value.
    const people: Person[] = ((athletes.data || []) as AthleteRow[])
      .filter(a => a.status !== REMOVED_STATUS)
      .map(a => ({
      id: a.id,
      name: a.name || '',
      role: a.role || 'runner',
      groupName: a.group_id ? groupName.get(a.group_id) ?? null : null,
      status: a.status || 'active',
      approved: a.approved ?? true,
      // Which credential is present. Both at once shows as Garmin.
      source: a.garmin_auth ? 'garmin' : a.strava_auth ? 'strava' : null,
      lastRunDay: lastRun.get(a.id) ?? null,
      lastSeenAt: a.last_seen_at,
      joinedAt: a.created_at,
      setupDone: !!a.onboarding_completed_at,
      pushDevices: push.get(a.id)?.n ?? 0,
      lastPushAt: push.get(a.id)?.last ?? null,
    }));

    return NextResponse.json({ today: israelToday(), people });
  } catch (error) {
    console.error('Failed to build people list:', error);
    return NextResponse.json({ error: 'Failed to build people list' }, { status: 500 });
  }
}
