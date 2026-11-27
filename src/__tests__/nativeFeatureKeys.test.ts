import { describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/features/flags';

/**
 * Every flag key the native iOS app reads (FeatureKey.allCases + CoachMgmtFlag raw values, b26-cand 28.11).
 * The native source lives in a private repo, so the list is copied here: when the app gains a key, add it
 * here AND to FEATURES. A key the server doesn't know is never returned by /api/features/me, so the app
 * silently keeps it off — that is how the stage-1 comment preview would have shipped dark (28.11).
 */
const NATIVE_KEYS = [
  "academy_chat_send",
  "academy_coach",
  "academy_pack",
  "academy_pack_attendance",
  "academy_pack_chat",
  "academy_pack_leader",
  "academy_race_plan",
  "academy_read_nudge",
  "academy_register",
  "academy_trainee",
  "academy_week_moments",
  "apple_health",
  "athlete_races",
  "birthday_year_card",
  "club_stats_monthly",
  "club_tab",
  "coach_late",
  "data_check",
  "data_sources",
  "feed_banner",
  "gateway_v4",
  "native_benefits",
  "native_chat_group_edit",
  "native_club_stories",
  "native_club_updates",
  "native_core_perks",
  "native_feed_comment_preview",
  "native_metrickit",
  "native_mgmt_access",
  "native_mgmt_athletes",
  "native_mgmt_attendance",
  "native_mgmt_birthdays",
  "native_mgmt_coach_insights",
  "native_mgmt_coach_tools",
  "native_mgmt_content",
  "native_mgmt_control_room",
  "native_mgmt_data_check",
  "native_mgmt_day_session",
  "native_mgmt_entry_queue",
  "native_mgmt_finance",
  "native_mgmt_groups",
  "native_mgmt_leads",
  "native_mgmt_manager_home_v2",
  "native_mgmt_numbers",
  "native_mgmt_onboarding_funnel",
  "native_mgmt_pack_moves",
  "native_mgmt_pack_stories",
  "native_mgmt_packs",
  "native_mgmt_pain",
  "native_mgmt_people",
  "native_mgmt_plan_builder",
  "native_mgmt_plan_history",
  "native_mgmt_podium_admin",
  "native_mgmt_push_health",
  "native_mgmt_registrations",
  "native_mgmt_release_rehearsal",
  "native_mgmt_review",
  "native_mgmt_rewards",
  "native_mgmt_roles",
  "native_mgmt_scheduled",
  "native_mgmt_signup_tests",
  "native_mgmt_staff_week",
  "native_mgmt_team_volume",
  "native_mgmt_training",
  "native_mgmt_u21_admin",
  "native_mgmt_users",
  "native_onboarding_setup",
  "native_pack_chat",
  "native_photos",
  "native_practice",
  "native_resend_workout",
  "native_run_share",
  "native_self_group_change",
  "native_share_v2",
  "native_store",
  "native_store_orders",
  "native_strava_signin",
  "native_surveys",
  "new_record_sheet",
  "notif_prefs",
  "perf_cache_first",
  "perf_get_memo",
  "perf_server_shapes",
  "photos_social",
  "profile_badges",
  "profile_edit",
  "profile_trend",
  "program_files",
  "race_live_phone",
  "records_tab",
  "run_chat",
  "run_detail_v2",
  "run_together",
  "season_program",
  "signin_magic",
  "strength_training",
  "teammate_full",
  "u21_entry",
  "valencia_v3",
  "week_summary",
  "wellness_strip"
] as const;


describe('native feature keys are all known to the server', () => {
  it('every native key is in FEATURES', () => {
    const missing = NATIVE_KEYS.filter((k) => !(k in FEATURES));
    expect(missing).toEqual([]);
  });
  it('every native key is off by default', () => {
    const on = NATIVE_KEYS.filter((k) => (FEATURES as Record<string, { defaultEnabled: boolean }>)[k]?.defaultEnabled);
    expect(on).toEqual([]);
  });
});
