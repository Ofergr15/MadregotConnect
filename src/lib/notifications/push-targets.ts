// ═════════════════════════════════════════════════════════════════════════════
// PUSH TARGETS — every in-app route a push notification may open.
//
// A push `url` is read by two clients: the web service worker (navigates to it)
// and the native app's PushTap (maps it onto a native screen). A url that neither
// knows lands the tap on the home screen with no explanation, which is how a push
// "doesn't work" without anything failing. So every url a payload builder emits
// must match a pattern here, and docs/push-targets.md is the list the native app
// routes against (task 52). Add the route here AND in the native router together.
//
// Patterns: literal path segments, `:param` for one dynamic segment. Query strings
// are allowed on any target and not matched. `#ledger:…` urls are not navigations
// (ledger rows in the inbox, never opened) and are accepted separately.
// ═════════════════════════════════════════════════════════════════════════════

export interface PushTarget {
  pattern: string;
  /** What the screen is — mirrored in docs/push-targets.md. */
  screen: string;
  /** Opened only by the native app; the web has no page at this path (the SW lands on home). */
  nativeOnly?: boolean;
}

export const PUSH_TARGETS: readonly PushTarget[] = [
  { pattern: '/feed', screen: 'Feed (optionally ?item=, ?activity=, ?weekStory=1)' },
  { pattern: '/dashboard', screen: 'Home' },
  { pattern: '/dashboard/profile', screen: 'Own profile (optionally ?tab=badges)' },
  { pattern: '/dashboard/teammate/:id', screen: "Teammate's profile" },
  { pattern: '/dashboard/teammate/:id/records/:bucket', screen: "A runner's record history for one distance" },
  { pattern: '/dashboard/run-together/:id', screen: 'One shared run (meetup)' },
  { pattern: '/dashboard/run-chat/:id', screen: 'Run chat thread' },
  { pattern: '/dashboard/calendar/:id', screen: 'Club calendar event' },
  { pattern: '/dashboard/surveys/:id', screen: 'Survey' },
  { pattern: '/dashboard/academy', screen: 'Academy home' },
  { pattern: '/dashboard/program', screen: 'Season program' },
  { pattern: '/dashboard/notifications', screen: 'Notification inbox' },
  { pattern: '/dashboard/notifications/approve', screen: 'Staff: push approvals' },
  { pattern: '/dashboard/store', screen: 'Store' },
  { pattern: '/dashboard/records', screen: 'Records tab' },
  { pattern: '/dashboard/entry-queue', screen: 'Staff: entry queue' },
  { pattern: '/dashboard/feedback', screen: 'Staff: runner feedback' },
  { pattern: '/dashboard/workout-feedback', screen: 'Post-workout feedback' },
  { pattern: '/dashboard/quality-session', screen: 'Quality session' },
  { pattern: '/dashboard/push-health', screen: 'Staff: push health' },
  { pattern: '/dashboard/photos', screen: 'Photos gallery' },
  { pattern: '/dashboard/week', screen: 'Staff: week setup' },
  { pattern: '/dashboard/settings', screen: 'Settings' },
  { pattern: '/dashboard/review', screen: 'Staff: review' },
  { pattern: '/dashboard/content', screen: 'Staff: content' },
  { pattern: '/chat/:id', screen: 'Group chat (groupChatUrl — no web page yet)', nativeOnly: true },
  { pattern: '/coach/pain/:id', screen: 'Staff: one pain report', nativeOnly: true },
  { pattern: '/me/pain/:id', screen: 'Own pain report', nativeOnly: true },
  { pattern: '/me/pain/:id/checkin', screen: 'Pain report check-in', nativeOnly: true },
] as const;

function segmentsMatch(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const u = path.split('/').filter(Boolean);
  if (p.length !== u.length) return false;
  return p.every((seg, i) => (seg.startsWith(':') ? u[i].length > 0 : seg === u[i]));
}

/** The target a push url opens, or null when no client knows the route. */
export function matchPushTarget(url: string): PushTarget | null {
  if (!url.startsWith('/')) return null;
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return PUSH_TARGETS.find((t) => segmentsMatch(t.pattern, path)) ?? null;
}

/** True for a url that is fine to put on a push: a known target or an inbox ledger row. */
export function isValidPushUrl(url: string): boolean {
  return url.startsWith('#ledger:') || matchPushTarget(url) !== null;
}
