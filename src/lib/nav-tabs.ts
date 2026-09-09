// The tab ids of ALL_NAV_ITEMS, and nothing else — no icons, no 'use client'.
//
// It exists because a server route needs the list. `@/lib/nav-items` is a client
// module (it carries lucide components and a hook), and importing ALL_NAV_ITEMS
// into a route handler does not give you the array: the client boundary hands the
// server a reference proxy, so `.map` is not a function and the build fails while
// collecting page data. The types check clean, which is what makes it worth a
// file and a comment.
//
// Kept honest by a test rather than by care: navItems.test.ts asserts this list
// is exactly ALL_NAV_ITEMS' tabs, in order, so adding a page without adding it
// here fails the suite instead of silently making that page ungrantable.
export const NAV_TAB_IDS = [
  'dashboard',
  'feed',
  'control-room',
  'review',
  'plan/new',
  'athletes',
  'academy',
  'groups',
  'activities',
  'program',
  'practice',
  'practice-attendance',
  'workout-feedback',
  'team-volume',
  'calendar',
  'history',
  'settings',
] as const;
