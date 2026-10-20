import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { REPORT_RUN_TYPES, runDateOf } from '@/lib/reports/last-7-days';
import type { Person } from '@/lib/admin/people';
import { REMOVED_STATUS } from '@/lib/admin/entry-queue';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { PUSH_DEAD_DAYS, pushLooksDead, type DeviceReceipt } from '@/lib/push-health';

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
  pending_group_id?: string | null;
  pending_group_from?: string | null;
  status: string | null;
  approved: boolean | null;
  garmin_auth: unknown;
  strava_auth: unknown;
  last_seen_at: string | null;
  created_at: string | null;
  onboarding_completed_at: string | null;
  is_academy?: boolean | null;
  is_core_runner?: boolean | null;
  avatar_url?: string | null;
  extra_roles?: string[] | null;
}

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const since = new Date(Date.now() - RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [athletes, groups, runs, pushes, recentSends, boots] = await Promise.all([
      // garmin_auth/strava_auth for PRESENCE only, exactly as /api/admin/users
      // reads them: the credentials never leave this function.
      supabase
        .from('athletes')
        .select('id, name, role, group_id, pending_group_id, pending_group_from, status, approved, garmin_auth:has_garmin, strava_auth:has_strava, last_seen_at, created_at, onboarding_completed_at, is_academy, is_core_runner, avatar_url, extra_roles')
        .eq('coach_id', COACH_ID)
        .or(NOT_ADMIN)
        .order('name'),
      supabase.from('groups').select('id, name').eq('coach_id', COACH_ID),
      // Every run in the window, paged. `.limit(5000)` read as "enough" but PostgREST
      // returns at most 1000 rows, and the club logs ~1,600 activities in 60 days:
      // a member whose latest run fell outside the newest thousand showed as "no
      // run in 60 days" (lib/supabase/paginate.ts, with the id tiebreak it asks for).
      fetchAllRows<{ athlete_id: string; start_time: string }>((from, to) => supabase
        .from('athlete_activities')
        .select('athlete_id, start_time')
        .in('activity_type', REPORT_RUN_TYPES)
        .gte('start_time', since)
        .order('start_time', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to))
        .then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
      supabase.from('push_subscriptions').select('athlete_id, created_at, last_success_at'),
      // Who was SENT something lately, for "notifications aren't arriving" (lib/push-health).
      supabase
        .from('scheduled_notifications')
        .select('audience_id')
        .eq('audience_type', 'athlete')
        .eq('status', 'sent')
        .gt('last_sent_at', new Date(Date.now() - PUSH_DEAD_DAYS * 86_400_000).toISOString())
        .limit(5000),
      // How each member last opened the app — the home-screen install ('app') or a
      // browser tab — from the reporter's boot event (ClientEventReporter). Newest
      // first, so the first row per member is their latest.
      fetchAllRows<{ athlete_id: string | null; message: string | null; created_at: string }>((from, to) => supabase
        .from('client_events')
        .select('athlete_id, message, created_at')
        .eq('kind', 'boot')
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to))
        .then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
    ]);
    if (athletes.error) throw athletes.error;

    const groupName = new Map(((groups.data || []) as { id: string; name: string }[]).map(g => [g.id, g.name]));

    const lastRun = new Map<string, string>();
    for (const r of (runs.data || []) as { athlete_id: string; start_time: string }[]) {
      const day = runDateOf(r.start_time);
      const seen = lastRun.get(r.athlete_id);
      if (!seen || day > seen) lastRun.set(r.athlete_id, day);
    }

    const sentTo = new Map<string, number>();
    for (const r of (recentSends.data || []) as { audience_id: string | null }[]) {
      if (r.audience_id) sentTo.set(r.audience_id, (sentTo.get(r.audience_id) || 0) + 1);
    }
    const devicesOf = new Map<string, DeviceReceipt[]>();
    for (const s of (pushes.data || []) as Array<DeviceReceipt & { athlete_id: string | null }>) {
      if (s.athlete_id) devicesOf.set(s.athlete_id, [...(devicesOf.get(s.athlete_id) || []), s]);
    }

    const opened = new Map<string, { as: 'app' | 'browser'; at: string }>();
    for (const b of (boots.data || [])) {
      if (!b.athlete_id || opened.has(b.athlete_id)) continue;
      if (b.message === 'app' || b.message === 'browser') opened.set(b.athlete_id, { as: b.message, at: b.created_at });
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
      groupId: a.group_id ?? null,
      // A move waiting for Saturday — the pack sheet shows it and can take it back.
      pendingGroupId: a.pending_group_id ?? null,
      pendingFrom: a.pending_group_from ?? null,
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
      pushDead: pushLooksDead(devicesOf.get(a.id) || [], sentTo.get(a.id) || 0),
      openedAs: opened.get(a.id)?.as ?? null,
      openedAt: opened.get(a.id)?.at ?? null,
      // The areas the People wall filters by, and the face it draws (2026-10-20).
      isAcademy: !!a.is_academy,
      isCore: !!a.is_core_runner,
      // A Strava placeholder ("avatar/athlete/large.png") is no photo.
      avatarUrl: a.avatar_url && /^https?:\/\//.test(a.avatar_url) ? a.avatar_url : null,
      extraRoles: a.extra_roles ?? [],
    }));

    return NextResponse.json({ today: israelToday(), people });
  } catch (error) {
    console.error('Failed to build people list:', error);
    return NextResponse.json({ error: 'Failed to build people list' }, { status: 500 });
  }
}
