// Kept apart from ./events so the many route tests that mock events stay valid.

/**
 * The door a sign-up came through — `signup_requests.channel` and `onboarding_events.channel` (migration 207).
 * `source` says what KIND of request it is (public form / Strava login / backfill) and can't tell the web form
 * from the native app, which post the same form to the same route. An allowlist: anything else reads as 'web',
 * because the web form is the one caller that has never sent the field.
 */
export const SIGNUP_CHANNELS = ['web', 'app_ios', 'invite'] as const;
export type SignupChannel = (typeof SIGNUP_CHANNELS)[number];
export function signupChannel(v: unknown): SignupChannel {
  return typeof v === 'string' && (SIGNUP_CHANNELS as readonly string[]).includes(v) ? (v as SignupChannel) : 'web';
}
/** For a client-reported event: the channel when it says one, else null (unknown, not 'web'). */
export function eventChannel(v: unknown): SignupChannel | null {
  return typeof v === 'string' && (SIGNUP_CHANNELS as readonly string[]).includes(v) ? (v as SignupChannel) : null;
}
