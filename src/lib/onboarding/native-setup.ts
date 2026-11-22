// The native first-run checklist (BUILD-BRIEF gap 5): four steps, each skippable,
// resumable from the feed. Progress lives on the server (athletes.setup_progress,
// migration 189) so a reinstall resumes where it stopped.
//
// What can be DERIVED is never stored: a watch is connected when Garmin or Strava
// is (Apple Health is device-only, so the app reports it as `watch: 'apple'`), and
// a photo is set when avatar_url is. What only the person can say — they answered
// the notification prompt, confirmed or asked to change their pack — is stored.

export const SETUP_STEPS = ['watch', 'notifications', 'group', 'photo'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupProgress {
  watch?: 'apple' | 'skipped';
  notifications?: 'granted' | 'denied' | 'skipped';
  group?: 'confirmed' | 'requested' | 'skipped';
  photo?: 'skipped';
  dismissedAt?: string;
  completedAt?: string;
}

/** The values a client may write for each step — anything else is a 400. */
export const SETUP_VALUES: Record<SetupStep, readonly string[]> = {
  watch: ['apple', 'skipped'],
  notifications: ['granted', 'denied', 'skipped'],
  group: ['confirmed', 'requested', 'skipped'],
  photo: ['skipped'],
};

export interface SetupState {
  steps: Record<SetupStep, { done: boolean; state: string | null }>;
  doneCount: number;
  complete: boolean;
  /** The first step not done — what the feed's resume card names. Skipped steps come back. */
  next: SetupStep | null;
  dismissed: boolean;
}

export function deriveSetup(input: {
  garminConnected: boolean;
  stravaConnected: boolean;
  avatarUrl: string | null | undefined;
  progress: SetupProgress | null | undefined;
}): SetupState {
  const p = input.progress || {};
  const watchVia = input.garminConnected ? 'garmin' : input.stravaConnected ? 'strava' : p.watch ?? null;
  const steps: SetupState['steps'] = {
    watch: { done: input.garminConnected || input.stravaConnected || p.watch === 'apple', state: watchVia },
    notifications: { done: p.notifications === 'granted' || p.notifications === 'denied', state: p.notifications ?? null },
    group: { done: p.group === 'confirmed' || p.group === 'requested', state: p.group ?? null },
    photo: { done: !!input.avatarUrl, state: input.avatarUrl ? 'set' : p.photo ?? null },
  };
  const doneCount = SETUP_STEPS.filter((s) => steps[s].done).length;
  return {
    steps,
    doneCount,
    complete: doneCount === SETUP_STEPS.length,
    next: SETUP_STEPS.find((s) => !steps[s].done) ?? null,
    dismissed: !!p.dismissedAt,
  };
}

/** Merge one client write into stored progress. Returns null for an invalid write. */
export function applySetupWrite(
  current: SetupProgress | null | undefined,
  write: { step?: unknown; value?: unknown; dismiss?: unknown },
  now = new Date(),
): SetupProgress | null {
  const next: SetupProgress = { ...(current || {}) };
  if (write.dismiss === true) {
    next.dismissedAt = now.toISOString();
    return next;
  }
  const step = write.step as SetupStep;
  if (!SETUP_STEPS.includes(step)) return null;
  if (typeof write.value !== 'string' || !SETUP_VALUES[step].includes(write.value)) return null;
  (next as Record<string, string>)[step] = write.value;
  return next;
}
