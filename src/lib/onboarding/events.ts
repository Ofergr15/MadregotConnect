import { createServerClient } from '@/lib/supabase/server';
import { APP_VERSION } from '@/lib/version';

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING EVENTS — one row per step a joining member takes (migration 139).
//
// Ofer, 2026-10-10: "metrics on how they connect and how long it took — very
// important to understand it works well". The tables already held a few
// timestamps (signup_requests.approved_at, athletes.first_seen_at, the tour
// stamps, push_subscriptions.created_at); what nobody could see was the middle:
// which device each step happened on, where people stalled (the install step,
// the code, notifications, the tour) and how long each took. /dashboard/
// onboarding-funnel reads these rows next to those timestamps.
//
// Recording NEVER fails the step it describes: a missing table (139 not applied)
// or any insert error is swallowed.
// ═════════════════════════════════════════════════════════════════════════════

/** Every step, in journey order. The dashboard orders by this list. */
export const ONB_STEPS = [
  'register_view', 'register_submitted',
  'notify_email_left', 'approved',
  'join_open', 'join_saved', 'install_guide_shown', 'continue_on_phone_shown', 'phone_link_mailed', 'continue_on_computer',
  'welcome_open', 'code_sent', 'code_verified', 'strava_login',
  'phone_app_opened',
  'first_run_start', 'push_prompted', 'push_granted', 'push_denied', 'push_later',
  'tour_start', 'tour_done', 'tour_skipped', 'latest_shown', 'latest_clicked',
  'garmin_connected', 'strava_connected',
] as const;
export type OnbStep = (typeof ONB_STEPS)[number];

/** Steps a browser may report (POST /api/onboarding/event). The rest are server-side only. */
export const CLIENT_STEPS: ReadonlySet<OnbStep> = new Set<OnbStep>([
  'register_view', 'join_open', 'join_saved', 'install_guide_shown', 'continue_on_phone_shown', 'continue_on_computer',
  'welcome_open', 'first_run_start', 'push_prompted', 'push_granted', 'push_denied', 'push_later',
  'tour_start', 'tour_done', 'tour_skipped', 'latest_shown', 'latest_clicked',
]);

export interface OnbEvent {
  step: OnbStep;
  athleteId?: string | null;
  signupRequestId?: string | null;
  device?: string | null;
  platform?: string | null;
  standalone?: boolean | null;
  meta?: Record<string, unknown>;
}

/** The device class from a User-Agent, for server-side events that have no client report. */
export function deviceFromUa(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/iphone|ipod/i.test(ua)) return 'iphone';
  if (/ipad/i.test(ua)) return 'ipad';
  if (/android/i.test(ua)) return 'android';
  return 'computer';
}

export async function recordOnbEvent(e: OnbEvent): Promise<void> {
  try {
    await createServerClient().from('onboarding_events').insert({
      step: e.step,
      athlete_id: e.athleteId ?? null,
      signup_request_id: e.signupRequestId ?? null,
      device: e.device ?? null,
      platform: e.platform ?? null,
      standalone: e.standalone ?? null,
      app_version: APP_VERSION,
      meta: e.meta ?? {},
    });
  } catch {
    /* never fail the step being recorded */
  }
}
