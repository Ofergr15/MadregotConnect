import { describe, expect, it } from 'vitest';
import { FEATURES, FEATURE_KEYS, PUBLIC_FEATURE_KEYS, resolveClubScope, type EnablementRow } from '@/lib/features/flags';

const row = (scope_type: EnablementRow['scope_type'], scope_id: string, enabled: boolean, feature = 'academy_register'): EnablementRow =>
  ({ feature, scope_type, scope_id, enabled });

describe('native build 16 flag keys', () => {
  it('exist and default off — the iOS FeatureKey enum reads these exact strings', () => {
    for (const k of ['events', 'run_together', 'program_files', 'academy_register', 'profile_badges', 'records_tab', 'native_mgmt_registrations', 'native_mgmt_groups', 'native_mgmt_roles', 'native_mgmt_scheduled', 'native_mgmt_staff_week', 'calendar', 'native_mgmt_attendance', 'academy_coach', 'academy_trainee', 'native_mgmt_entry_queue', 'native_mgmt_onboarding_funnel', 'native_mgmt_control_room', 'native_mgmt_push_health', 'native_mgmt_data_check', 'native_mgmt_numbers', 'academy_chat_send', 'notif_prefs', 'native_mgmt_packs', 'data_sources', 'season_program', 'profile_edit', 'native_club_updates', 'native_mgmt_day_session'] as const) {
      expect(FEATURE_KEYS).toContain(k);
      expect(FEATURES[k].defaultEnabled).toBe(false);
    }
  });
  it('only academy_register and u21_entry are readable signed out', () => {
    expect([...PUBLIC_FEATURE_KEYS]).toEqual(['academy_register', 'u21_entry']);
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
