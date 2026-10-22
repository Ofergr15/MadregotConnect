// The coach tour's club switch (Ofer, 2026-10-22: ship it, OFF until the admin turns it on).
// app_settings `coach_tour_enabled` = 'on' | 'off'; no row means OFF. It gates the opening
// offer, the blue dots and the "סיור מאמן" row for coaches. The super user can always try the
// tour from עוד (a preview, labelled "(כבוי לכולם)" while off). Server only for the reads.

import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

export const COACH_TOUR_KEY = 'coach_tour_enabled';

/** Only an explicit 'on' is on: a missing row or a typo keeps it off. */
export const parseCoachTourOn = (value: string | null | undefined) => value === 'on';

export async function isCoachTourOn(db: Db): Promise<boolean> {
  const { data, error } = await db.from('app_settings').select('value').eq('key', COACH_TOUR_KEY).maybeSingle();
  if (error) return false;
  return parseCoachTourOn((data as { value?: string } | null)?.value);
}

/** Who may flip it: the admin and the super user. */
export function mayToggleCoachTour(user: { isSuperUser: boolean; role?: string | null; roles?: string[] }): boolean {
  return user.isSuperUser || user.role === 'admin' || !!user.roles?.includes('admin');
}

/** What the client may show, given the switch and who is looking. */
export function tourVisibility(on: boolean, isSuper: boolean): { offer: boolean; hotspots: boolean; menu: boolean; preview: boolean } {
  return { offer: on, hotspots: on, menu: on || isSuper, preview: !on && isSuper };
}

/** The opening offer: the switch is on, the prefs are known, and it was never offered. */
export function shouldOfferCoachTour(ctx: { on: boolean; ready: boolean; stored: string | null | undefined }): boolean {
  return ctx.on && ctx.ready && !(ctx.stored === 'done' || ctx.stored === 'later' || ctx.stored === 'skipped');
}
