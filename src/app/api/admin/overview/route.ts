import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { getPlanWeekStart, israelDateAnchor, toISODate } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/overview — everything the admin control room shows, in ONE
// request.
//
// The admin's home page used to be the athlete home page with a coach strip
// bolted on top: it opened with a greeting and this account's own weekly
// kilometres, streak and records. That is the wrong first screen for the person
// who runs the club — the questions they open the app with are "who is waiting
// for me", "is anything broken" and "is next week published", none of which were
// anywhere on it. Personal training now lives on the Profile tab (which already
// holds the km table, the runs and the records) and this route feeds the screen
// that replaced it.
//
// ONE endpoint rather than six, deliberately: per-page API fan-out is a live
// performance problem in this app, and a control room whose numbers arrive in
// six separate waves reads as broken even when it isn't. Everything below is a
// COUNT (`head: true`) — no rows travel over the wire, so the payload is a few
// hundred bytes however big the club gets.
//
// Every count that depends on a hand-applied migration degrades to `null`
// instead of failing the request: migrations here are pasted into the Supabase
// SQL editor by hand, so "the table isn't there yet" is a normal state, and one
// missing column must not blank the whole screen. The UI hides a null row.
// ═════════════════════════════════════════════════════════════════════════════

/** '42P01' = undefined_table, '42703' = undefined_column. Both mean "not migrated yet". */
function notMigrated(code?: string) {
  return code === '42P01' || code === '42703' || code === 'PGRST204';
}

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();

    // The plan week the club is currently training to, and the one after it —
    // "is next week published yet" is the single most time-sensitive thing on
    // this screen. getPlanWeekStart rolls forward after Saturday 20:00 Israel
    // (the app previews the coming week from then), so on Saturday night this
    // correctly starts asking about the week after.
    const currentWeekStart = getPlanWeekStart(israelDateAnchor());
    const nextWeek = new Date(`${currentWeekStart}T12:00:00`);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStart = toISODate(nextWeek);

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      registrations,
      reports,
      unfinished,
      nextPlan,
      athletes,
      groups,
      deliveriesTotal,
      deliveriesOk,
      settings,
      syncedToday,
    ] = await Promise.all([
      // Migration 083. Oldest-first ordering doesn't matter for a count.
      supabase.from('signup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),

      // Every report in production is still `status = 'new'`, and rows written
      // before the status column existed carry NULL — which is the same thing
      // and would silently drop out of an `.eq('new')`.
      supabase.from('feedback').select('id', { count: 'exact', head: true }).or('status.is.null,status.eq.new'),

      // Migration 078. Signed up but never finished setting the app up — the
      // people whose app is half-configured and who will quietly not use it.
      supabase
        .from('athletes')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', COACH_ID)
        .eq('status', 'active')
        .is('onboarding_completed_at', null),

      // `status = 'pushed'` is what "published to the club" means here, same as
      // /api/plans/week reads it — a parsed-but-unpushed draft is not published.
      supabase
        .from('weekly_plans')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', COACH_ID)
        .eq('week_start_date', nextWeekStart)
        .eq('status', 'pushed'),

      supabase
        .from('athletes')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', COACH_ID)
        .eq('status', 'active'),

      supabase.from('groups').select('id', { count: 'exact', head: true }).eq('coach_id', COACH_ID),

      // Two counts rather than the whole status column: /api/dashboard/stats
      // computes the same rate by selecting every delivery row it can find and
      // filtering in JS, which grows with the club forever.
      supabase.from('workout_deliveries').select('id', { count: 'exact', head: true }),
      supabase.from('workout_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'success'),

      supabase.from('app_settings').select('key, value').eq('key', 'maintenance_mode'),

      // Not "is the integration up" — nobody can answer that from here — but
      // the observable consequence: did anything at all arrive from Garmin or
      // Strava in the last day. Zero on a weekday is the real alarm.
      supabase
        .from('athlete_activities')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', dayAgo),
    ]);

    const count = (r: { count: number | null; error: { code?: string } | null }) =>
      r.error ? (notMigrated(r.error.code) ? null : 0) : (r.count ?? 0);

    const total = count(deliveriesTotal) ?? 0;
    const ok = count(deliveriesOk) ?? 0;

    return NextResponse.json({
      // Things a person has to DO something about. Order is the order the screen
      // renders them in: whoever is waiting on a human comes before anything
      // that is merely worth knowing.
      attention: {
        pendingRegistrations: count(registrations),
        openReports: count(reports),
        unfinishedOnboarding: count(unfinished),
        nextWeekStart,
        nextWeekPublished: (count(nextPlan) ?? 0) > 0,
      },
      club: {
        athleteCount: count(athletes) ?? 0,
        groupCount: count(groups) ?? 0,
        deliverySuccessRate: total > 0 ? Math.round((ok / total) * 100) : null,
      },
      system: {
        maintenance: (settings.data || []).some(
          (r: { key: string; value: string }) => r.key === 'maintenance_mode' && r.value === 'on',
        ),
        syncedLast24h: count(syncedToday) ?? 0,
      },
    });
  } catch (error) {
    console.error('Failed to build admin overview:', error);
    return NextResponse.json({ error: 'Failed to build admin overview' }, { status: 500 });
  }
}
