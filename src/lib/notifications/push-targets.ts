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

/**
 * The native app's screen for a push (task 83). One kind per target, so the url → screen map
 * has a single source: this file. The native router switches on `kind`; params are the
 * pattern's `:name` segments, query is passed through.
 */
export const NATIVE_TARGET_KINDS = [
  'feed', 'home', 'profile', 'teammate', 'recordHistory', 'meetup', 'runChat', 'event', 'survey',
  'academy', 'program', 'inbox', 'pushApprovals', 'store', 'records', 'entryQueue', 'runnerFeedback',
  'workoutFeedback', 'qualitySession', 'pushHealth', 'photos', 'weekSetup', 'settings', 'review',
  'content', 'groupChat', 'coachPain', 'painReport', 'painCheckin',
] as const;
export type NativeTargetKind = (typeof NATIVE_TARGET_KINDS)[number];

export interface PushTarget {
  pattern: string;
  kind: NativeTargetKind;
  /** What the screen is — mirrored in docs/push-targets.md. */
  screen: string;
  /** Opened only by the native app; the web has no page at this path (the SW lands on home). */
  nativeOnly?: boolean;
}

export const PUSH_TARGETS: readonly PushTarget[] = [
  { pattern: '/feed', kind: 'feed', screen: 'Feed (optionally ?item=, ?activity=, ?weekStory=1)' },
  { pattern: '/dashboard', kind: 'home', screen: 'Home' },
  { pattern: '/dashboard/profile', kind: 'profile', screen: 'Own profile (optionally ?tab=badges)' },
  { pattern: '/dashboard/teammate/:id', kind: 'teammate', screen: "Teammate's profile" },
  { pattern: '/dashboard/teammate/:id/records/:bucket', kind: 'recordHistory', screen: "A runner's record history for one distance" },
  { pattern: '/dashboard/run-together/:id', kind: 'meetup', screen: 'One shared run (meetup)' },
  { pattern: '/dashboard/run-chat/:id', kind: 'runChat', screen: 'Run chat thread' },
  { pattern: '/dashboard/calendar/:id', kind: 'event', screen: 'Club calendar event' },
  { pattern: '/dashboard/surveys/:id', kind: 'survey', screen: 'Survey' },
  { pattern: '/dashboard/academy', kind: 'academy', screen: 'Academy home' },
  { pattern: '/dashboard/program', kind: 'program', screen: 'Season program' },
  { pattern: '/dashboard/notifications', kind: 'inbox', screen: 'Notification inbox' },
  { pattern: '/dashboard/notifications/approve', kind: 'pushApprovals', screen: 'Staff: push approvals' },
  { pattern: '/dashboard/store', kind: 'store', screen: 'Store' },
  { pattern: '/dashboard/records', kind: 'records', screen: 'Records tab' },
  { pattern: '/dashboard/entry-queue', kind: 'entryQueue', screen: 'Staff: entry queue' },
  { pattern: '/dashboard/feedback', kind: 'runnerFeedback', screen: 'Staff: runner feedback' },
  { pattern: '/dashboard/workout-feedback', kind: 'workoutFeedback', screen: 'Post-workout feedback' },
  { pattern: '/dashboard/quality-session', kind: 'qualitySession', screen: 'Quality session' },
  { pattern: '/dashboard/push-health', kind: 'pushHealth', screen: 'Staff: push health' },
  { pattern: '/dashboard/photos', kind: 'photos', screen: 'Photos gallery' },
  { pattern: '/dashboard/week', kind: 'weekSetup', screen: 'Staff: week setup' },
  { pattern: '/dashboard/settings', kind: 'settings', screen: 'Settings' },
  { pattern: '/dashboard/review', kind: 'review', screen: 'Staff: review' },
  { pattern: '/dashboard/content', kind: 'content', screen: 'Staff: content' },
  { pattern: '/chat/:id', kind: 'groupChat', screen: 'Group chat (groupChatUrl — no web page yet)', nativeOnly: true },
  { pattern: '/coach/pain/:id', kind: 'coachPain', screen: 'Staff: one pain report', nativeOnly: true },
  { pattern: '/me/pain/:id', kind: 'painReport', screen: 'Own pain report', nativeOnly: true },
  { pattern: '/me/pain/:id/checkin', kind: 'painCheckin', screen: 'Pain report check-in', nativeOnly: true },
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

export interface NativeTarget {
  kind: NativeTargetKind;
  /** The pattern's `:name` segments, decoded. */
  params: Record<string, string>;
  /** The url's query string, decoded (e.g. { item: '…' } for /feed?item=…). */
  query: Record<string, string>;
}

/**
 * url → native screen. `#ledger:` rows and unknown urls → null (the native app then opens the
 * inbox, which is where a ledger row lives anyway). Decoding never throws on a bad escape.
 */
export function toNativeTarget(url: string): NativeTarget | null {
  const t = matchPushTarget(url);
  if (!t) return null;
  const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
  const [pathPart, rest = ''] = url.split('?', 2);
  const path = pathPart.split('#')[0].replace(/\/+$/, '');
  const p = t.pattern.split('/').filter(Boolean);
  const u = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  p.forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = dec(u[i]); });
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rest.split('#')[0])) query[k] = v;
  return { kind: t.kind, params, query };
}

/** The whole map, for GET /api/push/targets and docs/push-targets.md. */
export function nativeRoutingMap(): Array<{ pattern: string; kind: NativeTargetKind; nativeOnly: boolean }> {
  return PUSH_TARGETS.map((t) => ({ pattern: t.pattern, kind: t.kind, nativeOnly: !!t.nativeOnly }));
}
