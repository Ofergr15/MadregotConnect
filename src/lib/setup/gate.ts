/**
 * The setup a new member finishes before the app opens (mockup join-flow-mockup.html,
 * Ofer 2026-10-20): install, Garmin (or "I have none" — Strava came with the sign-in), notifications, and the details
 * the coach needs — only what is missing. Pure: the screen asks it which steps remain.
 */

export type SetupStep = 'install' | 'watch' | 'push' | 'details';
export const SETUP_ORDER: SetupStep[] = ['install', 'watch', 'push', 'details'];

export interface SetupFacts {
  /** The installed app was opened (lib/onboarding/phone-app), or this is it. */
  installed: boolean;
  /** A computer has nothing to install and no push to grant here. */
  phone: boolean;
  /** Members sign in with Strava, so it is usually there before setup starts. */
  strava: boolean;
  garmin: boolean;
  /** "No Garmin" — the watch step passes without it (notification_prefs.setup.noWatch). */
  noWatch: boolean;
  push: boolean;
  birthDate: string | null;
  heightCm: number | null;
  sizes: Array<string | null>;
  /**
   * The member said "הכל נכון" on the details step (notification_prefs.setup.detailsConfirmedAt).
   * Absent = treated as confirmed, so a caller that does not know keeps today's behaviour.
   */
  detailsConfirmed?: boolean;
  /**
   * The member chose "ממשיכים בדפדפן" on the install step (notification_prefs.setup.browserAt).
   * It passes the install step only: `installed` stays the truth, so the profile row and the
   * later install sheet/strip still offer the app. Absent = never chose, today's behaviour.
   */
  browserChosen?: boolean;
}

/** The details still missing — birth date, height, the five kit sizes. Weight is never required. */
export function missingDetails(f: Pick<SetupFacts, 'birthDate' | 'heightCm' | 'sizes'>): { birthDate: boolean; height: boolean; sizes: boolean } {
  return { birthDate: !f.birthDate, height: !f.heightCm, sizes: f.sizes.some((s) => !s) };
}

/**
 * How the details step shows, or null when it is not needed: 'required' while something is
 * missing; 'confirm' when everything is known (import file, form, registration) but the member
 * has not yet confirmed it — prefilled, one "הכל נכון" tap. Once confirmed it never asks again.
 */
export function detailsMode(f: Pick<SetupFacts, 'birthDate' | 'heightCm' | 'sizes' | 'detailsConfirmed'>): 'required' | 'confirm' | null {
  const d = missingDetails(f);
  if (d.birthDate || d.height || d.sizes) return 'required';
  return f.detailsConfirmed === false ? 'confirm' : null;
}

export function remainingSteps(f: SetupFacts): SetupStep[] {
  return SETUP_ORDER.filter((s) => {
    if (s === 'install') return f.phone && !f.installed && !f.browserChosen;
    // The step is Garmin: it is the one that can push workouts to the watch, and Strava
    // came with the sign-in. Shown until Garmin is linked or they say they have none.
    if (s === 'watch') return !f.garmin && !f.noWatch;
    // On iPhone a push needs the installed app: asked once installed (or on Android).
    if (s === 'push') return f.phone && !f.push;
    return detailsMode(f) !== null;
  });
}
