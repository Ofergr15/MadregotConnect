/** Where the day-session flow's close button lands when there is no in-app page to go back to. */
export const DAY_SESSION_EXIT_HREF = '/dashboard/coach-tools';

/**
 * Where the close ✕ leaves the flow to: back, when the coach got here from another page of
 * the app; the coach tools otherwise. A push deep link (?date=…&track=1) opens the flow as
 * the first entry of the window's history, and `router.back()` there would leave the app.
 */
export function daySessionExitTarget(historyLength: number): 'back' | typeof DAY_SESSION_EXIT_HREF {
  return historyLength > 1 ? 'back' : DAY_SESSION_EXIT_HREF;
}
