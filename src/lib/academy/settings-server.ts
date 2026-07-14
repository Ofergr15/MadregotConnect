import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { AcademySettings, normalizeSettings, DEFAULT_ACADEMY_SETTINGS } from './settings';

// Load the coach's academy settings, falling back to defaults if unset or the
// table isn't migrated yet. Never throws — callers get usable defaults.
export async function loadAcademySettings(): Promise<AcademySettings> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_settings')
      .select('settings')
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_ACADEMY_SETTINGS };
    return normalizeSettings(data.settings);
  } catch {
    return { ...DEFAULT_ACADEMY_SETTINGS };
  }
}
