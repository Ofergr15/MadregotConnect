'use client';

import { useApi, apiHeaders } from '@/lib/api';
import type { SetupState } from './setup-tasks';

/**
 * One SWR key for both onboarding surfaces. The setup card and the first-run
 * tour read the same state and SWR dedupes them, so mounting both costs one
 * request — and marking the tour seen revalidates the card in the same tick.
 */
export const ONBOARDING_KEY = '/api/onboarding';

export type OnboardingState =
  /** Staff with no athlete row — nothing to score, nothing to nag about. */
  | { applicable: false }
  | ({
      applicable: true;
      /** False until migration 078 is applied; the flags below are then guesses. */
      migrated: boolean;
      tourSeen: boolean;
      tourSeenAt: string | null;
      completed: boolean;
      completedAt: string | null;
    } & SetupState);

export function useOnboarding() {
  return useApi<OnboardingState>(ONBOARDING_KEY);
}

/**
 * Stamp `onboarding_tour_seen_at` / `onboarding_completed_at`.
 *
 * Resolves false on any failure, including the 501 that means 078 hasn't been
 * pasted in yet. Callers hide their UI regardless: a tour that refuses to
 * dismiss because a column is missing is worse than one that replays tomorrow.
 */
export async function markOnboarding(patch: { markTourSeen?: boolean; markCompleted?: boolean }): Promise<boolean> {
  try {
    const res = await fetch(ONBOARDING_KEY, {
      method: 'POST',
      headers: await apiHeaders(true),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}
