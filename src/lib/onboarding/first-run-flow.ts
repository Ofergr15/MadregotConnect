// Onboarding v2's first run inside the app, as ONE sequence: a welcome → the
// notifications step → the tour → the setup card. Before this each of those
// decided on its own whether to appear, which is how a member could enable
// notifications and get no tour at all, or get "what's new" in front of both.
//
// The sequence's position is device state (the welcome is shown on the device
// where they first open the app), one key per athlete:
//   absent  — not started: FirstRunFlow shows the welcome
//   'tour'  — welcome and notifications done: FirstRunTour may start
//   'done'  — the tour ended: the old per-component rules apply again
export type FirstRunStage = 'tour' | 'done';
export const firstRunKey = (athleteId: string) => `mc-first-run:${athleteId}`;
export const FIRST_RUN_EVENT = 'mc:first-run-stage';

export function readFirstRunStage(athleteId: string | null): FirstRunStage | null {
  if (!athleteId) return null;
  try {
    const v = localStorage.getItem(firstRunKey(athleteId));
    return v === 'tour' || v === 'done' ? v : null;
  } catch {
    return 'done'; // private mode: never trap anyone in a sequence we cannot record
  }
}

export function setFirstRunStage(athleteId: string, stage: FirstRunStage): void {
  try { localStorage.setItem(firstRunKey(athleteId), stage); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(FIRST_RUN_EVENT, { detail: stage }));
}
