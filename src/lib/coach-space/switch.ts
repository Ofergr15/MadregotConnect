// The coach space's club switch (Ofer, 2026-10-23: build it behind a switch, OFF until he
// turns it on). app_settings `coach_space_enabled` = 'on' | 'off'; no row means OFF — the
// same idiom as the coach tour (lib/tour/switch.ts). ON: a coach's bottom bar becomes
// היום · השבוע · רצים · תובנות (+ עוד). OFF: coaches see exactly today's bar. The super user
// can preview it while it is off (lib/coach-space/use-coach-space.ts). Server only.

import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

export const COACH_SPACE_KEY = 'coach_space_enabled';

/** Only an explicit 'on' is on: a missing row or a typo keeps it off. */
export const parseCoachSpaceOn = (value: string | null | undefined) => value === 'on';

export async function isCoachSpaceOn(db: Db): Promise<boolean> {
  const { data, error } = await db.from('app_settings').select('value').eq('key', COACH_SPACE_KEY).maybeSingle();
  if (error) return false;
  return parseCoachSpaceOn((data as { value?: string } | null)?.value);
}

/** Who may flip it: the admin and the super user (the same people as the coach tour). */
export function mayToggleCoachSpace(user: { isSuperUser: boolean; role?: string | null; roles?: string[] }): boolean {
  return user.isSuperUser || user.role === 'admin' || !!user.roles?.includes('admin');
}
