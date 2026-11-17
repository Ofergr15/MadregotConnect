// Which signed-in screens may use the full desktop width (md and up).
//
// The (app) shell already allows max-w-7xl; what kept some admin screens in a
// phone-width column on a computer was the page's own cap (max-w-md / 3xl / 4xl /
// 5xl). <WidePage> (components/WidePage.tsx) lifts that cap from `md` up — and only
// on the routes below. Below `md` nothing changes: every class it adds is md:-prefixed.
//
// Runner personal screens are listed in NARROW_PREFIXES on purpose: they are
// built as one phone column and must stay that way even on a desktop.

export const WIDE_PREFIXES = [
  '/dashboard/athletes',
  '/dashboard/people',
  '/dashboard/academy',
  '/dashboard/registrations',
  '/dashboard/entry-queue',
  '/dashboard/workout-feedback',
  '/dashboard/coach-tools',
  '/dashboard/control-room',
  '/dashboard/groups',
  '/dashboard/roles',
  '/dashboard/access',
  '/dashboard/numbers',
  '/dashboard/onboarding-funnel',
  '/dashboard/push-health',
  '/dashboard/data-check',
  '/dashboard/feedback',
] as const;

export const NARROW_PREFIXES = [
  '/feed',
  '/dashboard/feed',
  '/dashboard/profile',
  '/dashboard/week',
  '/dashboard/records',
  '/dashboard/history',
  '/dashboard/activities',
  '/dashboard/calendar',
  '/dashboard/program',
  '/dashboard/run-together',
  '/dashboard/benefits',
  '/dashboard/notifications',
] as const;

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/** True when the screen at `pathname` should spread across the desktop width. */
export function isWidePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (NARROW_PREFIXES.some((p) => matches(path, p))) return false;
  return WIDE_PREFIXES.some((p) => matches(path, p));
}
