import type { SupabaseClient } from '@supabase/supabase-js';

// Removing a member, the two ways (Ofer 10-21: "soft, and a sweeping delete so they're
// in nothing — with a confirmation first"). Pure lists and the two operations; the route
// (api/admin/people/delete) does the auth and the guards.
//
// SOFT: out of the club and nothing is pulled any more — status 'removed' (every
// club-facing read already filters it), the Garmin / Strava connections dropped (the sync
// reads everyone with credentials, whatever their status), push subscriptions gone. The
// history stays, and an admin can bring them back from the same screen.
//
// FULL: every row about them, in every table that has one, then the athlete row, then the
// login. Measured against prod 10-21: these are the tables with a column that IS the
// person. Columns that name somebody ELSE (a coach's `author_id` on a trainee's test) are
// deliberately not here: deleting a coach must not delete their trainees' data — those
// FKs are ON DELETE SET NULL.

export const SUBJECT_COLUMNS: Array<[table: string, column: string]> = [
  // What they did and said
  ['feed_likes', 'athlete_id'], ['feed_comments', 'athlete_id'], ['feed_items', 'author_athlete_id'],
  ['club_update_reactions', 'athlete_id'], ['club_updates', 'author_athlete_id'],
  ['survey_responses', 'athlete_id'], ['run_chats', 'athlete_id'], ['run_meetup_messages', 'athlete_id'],
  ['run_meetup_requests', 'athlete_id'], ['event_registrations', 'athlete_id'], ['workout_attendance', 'athlete_id'],
  ['workout_feedback', 'athlete_id'], ['feedback', 'athlete_id'], ['store_orders', 'athlete_id'],
  // Their running
  ['activity_plan_matches', 'athlete_id'], ['race_matches', 'athlete_id'], ['race_results', 'athlete_id'],
  ['athlete_pr_exclusions', 'athlete_id'], ['athlete_pr_overrides', 'athlete_id'], ['athlete_badges', 'athlete_id'],
  ['athlete_wellness', 'athlete_id'], ['weekly_km_snapshots', 'athlete_id'], ['benchmark_results', 'athlete_id'],
  ['shoes', 'athlete_id'], ['athlete_activities', 'athlete_id'],
  // Plans and the academy
  ['workout_deliveries', 'athlete_id'], ['weekly_plans', 'athlete_id'], ['academy_workout_feedback', 'athlete_id'],
  ['academy_tests', 'athlete_id'], ['academy_test_analyses', 'athlete_id'], ['academy_test_invitations', 'athlete_id'],
  ['academy_trainee_coaches', 'athlete_id'], ['academy_coach_history', 'athlete_id'], ['academy_library_favourites', 'athlete_id'],
  ['academy_payments', 'athlete_id'], ['academy_billing', 'athlete_id'], ['academy_candidates', 'athlete_id'],
  // Social graph, photos, stories
  ['athlete_follows', 'follower_id'], ['athlete_follows', 'followee_id'], ['athlete_favorites', 'athlete_id'],
  ['athlete_faces', 'athlete_id'], ['detected_faces', 'athlete_id'], ['story_instances', 'athlete_id'], ['story_testers', 'athlete_id'],
  ['athlete_pack_history', 'athlete_id'],
  // Plumbing
  ['push_subscriptions', 'athlete_id'], ['email_log', 'athlete_id'], ['onboarding_events', 'athlete_id'],
  ['client_events', 'athlete_id'], ['signup_requests', 'athlete_id'],
];

/** The club's posts ABOUT them (a birthday, a cheer, a celebration) — not authored by them. */
export const ABOUT_THEM_PAYLOAD_KEYS = ['honoreeId', 'birthdayOf', 'cheerFor'];

const missing = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204');

export interface PurgeReport { removed: Record<string, number>; failed: string[]; authUsers: number }

/** Soft: out of the club and no more data pulled. Returns what it changed. */
export async function softRemove(db: SupabaseClient, athleteId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from('athletes').update({ status: 'removed', garmin_auth: null, strava_auth: null }).eq('id', athleteId);
  if (error) return { ok: false, error: error.message };
  await db.from('push_subscriptions').delete().eq('athlete_id', athleteId);
  return { ok: true };
}

/** Full: every row about them, the athlete row, and their login(s). */
export async function purgeAthlete(db: SupabaseClient, a: { id: string; email: string | null; strava_athlete_id: number | null }): Promise<PurgeReport & { ok: boolean; error?: string }> {
  const removed: Record<string, number> = {};
  const failed: string[] = [];
  for (const key of ABOUT_THEM_PAYLOAD_KEYS) {
    const { data, error } = await db.from('feed_items').delete().eq(`payload->>${key}`, a.id).select('id');
    if (error && !missing(error)) failed.push(`feed_items.payload.${key}`);
    else if (data?.length) removed[`feed_items (${key})`] = data.length;
  }
  for (const [table, column] of SUBJECT_COLUMNS) {
    const { data, error } = await db.from(table).delete().eq(column, a.id).select(column);
    if (error) { if (!missing(error)) failed.push(`${table}.${column}: ${error.message}`); continue; }
    if (data?.length) removed[table] = (removed[table] ?? 0) + data.length;
  }
  const { error } = await db.from('athletes').delete().eq('id', a.id);
  if (error) return { ok: false, error: error.message, removed, failed, authUsers: 0 };
  // Their login: the real address, and the synthetic one a Strava sign-in made.
  const emails = new Set([a.email, a.strava_athlete_id ? `strava_${a.strava_athlete_id}@strava.madregot.local` : null].filter((e): e is string => !!e).map((e) => e.toLowerCase()));
  let authUsers = 0;
  try {
    for (let page = 1; page <= 20 && emails.size; page++) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email && emails.has(u.email.toLowerCase())) {
          const r = await db.auth.admin.deleteUser(u.id);
          if (!r.error) { authUsers++; emails.delete(u.email.toLowerCase()); }
        }
      }
      if (users.length < 1000) break;
    }
  } catch (e) { failed.push(`auth: ${(e as Error).message}`); }
  return { ok: true, removed, failed, authUsers };
}
