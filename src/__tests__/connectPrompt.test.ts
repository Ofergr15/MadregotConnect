import { describe, expect, it } from 'vitest';
import { connectPromptVariant } from '@/lib/connect-prompt';

/**
 * The popup asked one question — "connect Strava or Garmin" — and fell silent as
 * soon as either arrived. That is right for seeing somebody's runs and wrong for
 * sending them a workout: Garmin is the only route to a watch, so a Strava-only
 * member was fully visible in the club and quietly getting no training plan.
 *
 * These pin the one line that matters in both directions: a Garmin is never nagged,
 * and a Strava-only member is.
 */
describe('connectPromptVariant', () => {
  it('asks for Garmin from somebody who only has Strava', () => {
    // The new common case: a Strava sign-in never walks /join, which is where the
    // Garmin step lives, so this is how they arrive.
    expect(connectPromptVariant({ hasStrava: true, hasGarmin: false })).toBe('garmin');
  });

  it('asks for either from an account with no data source at all', () => {
    expect(connectPromptVariant({ hasStrava: false, hasGarmin: false })).toBe('any');
    // A read that could not answer is the same question, not a reason to stay quiet.
    expect(connectPromptVariant({})).toBe('any');
  });

  it('asks nothing of anyone who has a Garmin', () => {
    // Whether Strava is also connected is then a preference — the watch works either
    // way, and that is the only thing this prompt exists to fix.
    expect(connectPromptVariant({ hasGarmin: true, hasStrava: false })).toBe('none');
    expect(connectPromptVariant({ hasGarmin: true, hasStrava: true })).toBe('none');
  });
});
