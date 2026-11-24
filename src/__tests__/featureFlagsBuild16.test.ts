import { describe, expect, it } from 'vitest';
import { FEATURES, FEATURE_KEYS, PUBLIC_FEATURE_KEYS, resolveClubScope, type EnablementRow } from '@/lib/features/flags';

const row = (scope_type: EnablementRow['scope_type'], scope_id: string, enabled: boolean, feature = 'academy_register'): EnablementRow =>
  ({ feature, scope_type, scope_id, enabled });

describe('native build 16 flag keys', () => {
  it('exist and default off — the iOS FeatureKey enum reads these exact strings', () => {
    for (const k of ['events', 'run_together', 'program_files', 'academy_register', 'profile_badges', 'records_tab', 'native_mgmt_registrations', 'native_mgmt_groups', 'native_mgmt_roles', 'native_mgmt_scheduled', 'native_mgmt_staff_week', 'calendar', 'native_mgmt_attendance', 'academy_coach', 'academy_trainee', 'native_mgmt_entry_queue', 'native_mgmt_onboarding_funnel', 'native_mgmt_control_room', 'native_mgmt_push_health', 'native_mgmt_data_check', 'native_mgmt_numbers', 'academy_chat_send', 'notif_prefs', 'native_mgmt_packs', 'data_sources', 'season_program', 'profile_edit', 'native_club_updates', 'native_mgmt_day_session', 'native_mgmt_coach_tools', 'native_mgmt_athletes', 'native_photos', 'perf_cache_first', 'perf_server_shapes', 'club_tab', 'native_benefits', 'native_club_stories', 'native_core_perks', 'native_mgmt_access', 'native_mgmt_birthdays', 'native_mgmt_content', 'native_mgmt_pack_moves', 'native_mgmt_pain', 'native_mgmt_people', 'native_mgmt_plan_builder', 'native_mgmt_review', 'native_mgmt_signup_tests', 'native_mgmt_team_volume', 'native_mgmt_training', 'native_practice', 'native_run_share', 'native_store', 'native_surveys', 'perf_get_memo', 'profile_trend', 'run_chat', 'search', 'teammate_full', 'native_mgmt_pack_stories', 'native_review', 'native_resend_workout', 'run_detail_v2', 'native_onboarding_setup', 'native_self_group_change', 'club_stats_monthly', 'native_mgmt_leads', 'native_mgmt_manager_home_v2'] as const) {
      expect(FEATURE_KEYS).toContain(k);
      expect(FEATURES[k].defaultEnabled).toBe(false);
    }
  });
  // native_onboarding_setup (b22): the signed-out gateway reports register_view only when this is on club-wide.
  it('only academy_register, u21_entry and native_onboarding_setup are readable signed out', () => {
    expect([...PUBLIC_FEATURE_KEYS]).toEqual(['academy_register', 'u21_entry', 'native_onboarding_setup']);
  });
});

describe('resolveClubScope — the signed-out answer', () => {
  it('is off with no rows', () => {
    expect(resolveClubScope('academy_register', [])).toBe(false);
  });
  it('follows the club row only', () => {
    expect(resolveClubScope('academy_register', [row('club', '*', true)])).toBe(true);
    expect(resolveClubScope('academy_register', [row('club', '*', false)])).toBe(false);
  });
  it('never discloses a per-athlete, squad, role or academy row', () => {
    const rows = [row('athlete', 'a1', true), row('squad', 'g1', true), row('role', 'runner', true), row('academy', 'academy', true)];
    expect(resolveClubScope('academy_register', rows)).toBe(false);
  });
  it('ignores other features', () => {
    expect(resolveClubScope('academy_register', [row('club', '*', true, 'events')])).toBe(false);
  });
});
