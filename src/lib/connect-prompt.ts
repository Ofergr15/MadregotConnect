/**
 * Which "connect something" nudge an athlete should see, if any.
 *
 * There are two different missing things here and they were treated as one. The
 * popup asked "connect Strava OR Garmin" and went quiet the moment either one
 * arrived — which is right for the runs (Strava is enough to see them) and wrong
 * for the watch. Garmin is the only path a coach's workout takes to a watch, so a
 * Strava-only member is fully visible in the club and silently receives no
 * training plan. Nothing anywhere said so, to them or to the coach.
 *
 * That case became the common one when a Strava sign-in stopped needing an invite
 * (src/lib/signup-queue.ts): those members never walk /join, which is where the
 * Garmin step lives, so they arrive with a Strava token and nothing else.
 *
 * Kept pure and separate from the component so the decision — and specifically
 * "an athlete with a Garmin is never nudged" — is testable without a DOM.
 */
export type ConnectPromptVariant =
  /** Nothing to ask for: they have a Garmin, so the plan can reach their watch. */
  | 'none'
  /** No data source at all — a Google-only account. Ask for either. */
  | 'any'
  /** Runs flow in from Strava, but no workout can reach their watch. Ask for Garmin. */
  | 'garmin';

export function connectPromptVariant(athlete: {
  hasGarmin?: boolean | null;
  hasStrava?: boolean | null;
}): ConnectPromptVariant {
  // Garmin first, deliberately: it is the one that settles the question. Having it
  // means the watch works, and whether Strava is also connected is a preference.
  if (athlete.hasGarmin) return 'none';
  return athlete.hasStrava ? 'garmin' : 'any';
}
