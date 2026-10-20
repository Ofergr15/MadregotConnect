/**
 * The setup a new member finishes before the app opens (mockup join-flow-mockup.html,
 * Ofer 2026-10-20): install, a watch (or "I have none"), notifications, and the details
 * the coach needs — only what is missing. Pure: the screen asks it which steps remain.
 */

export type SetupStep = 'install' | 'watch' | 'push' | 'details';
export const SETUP_ORDER: SetupStep[] = ['install', 'watch', 'push', 'details'];

export interface SetupFacts {
  /** The installed app was opened (lib/onboarding/phone-app), or this is it. */
  installed: boolean;
  /** A computer has nothing to install and no push to grant here. */
  phone: boolean;
  connected: boolean;
  noWatch: boolean;
  push: boolean;
  birthDate: string | null;
  heightCm: number | null;
  sizes: Array<string | null>;
}

/** The details still missing — birth date, height, the five kit sizes. Weight is never required. */
export function missingDetails(f: Pick<SetupFacts, 'birthDate' | 'heightCm' | 'sizes'>): { birthDate: boolean; height: boolean; sizes: boolean } {
  return { birthDate: !f.birthDate, height: !f.heightCm, sizes: f.sizes.some((s) => !s) };
}

export function remainingSteps(f: SetupFacts): SetupStep[] {
  const d = missingDetails(f);
  return SETUP_ORDER.filter((s) => {
    if (s === 'install') return f.phone && !f.installed;
    if (s === 'watch') return !f.connected && !f.noWatch;
    // On iPhone a push needs the installed app: asked once installed (or on Android).
    if (s === 'push') return f.phone && !f.push;
    return d.birthDate || d.height || d.sizes;
  });
}
