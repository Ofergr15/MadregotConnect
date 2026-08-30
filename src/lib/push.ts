import webpush from 'web-push';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { kudosScope, rsvpScope, signActionToken } from '@/lib/auth/action-token';

/**
 * Given the maintenance allowlist (lowercased emails) and the athlete rows for
 * the current subscriptions' recipients, returns the set of athlete ids
 * allowed through. Pure — the DB round trips live in filterForMaintenance
 * below, which is what callers actually use.
 */
export function computeMaintenanceAllowedIds(
  allowEmails: Set<string>,
  athleteRows: Array<{ id: string; email: string | null }>,
): Set<string> {
  return new Set(
    athleteRows
      .filter((a) => allowEmails.has((a.email || '').toLowerCase()))
      .map((a) => a.id),
  );
}

/**
 * When maintenance mode is ON, only athletes whose email is on the saved
 * maintenance allowlist (or an approver) may receive push. Returns the subs
 * unchanged when maintenance is off. Fails OPEN (returns all) on error.
 */
async function filterForMaintenance(subs: SubRow[]): Promise<SubRow[]> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('app_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_allow']);
    const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
    if (map['maintenance_mode'] !== 'on') return subs;
    // Allowlist controls everyone during maintenance (approvers are not auto-exempt).
    const allowEmails = new Set(
      String(map['maintenance_allow'] || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
    );
    const ids = [...new Set(subs.map(s => s.athlete_id).filter(Boolean))];
    const { data: aths } = await supabase.from('athletes').select('id, email').in('id', ids);
    const allowedIds = computeMaintenanceAllowedIds(allowEmails, (aths || []) as Array<{ id: string; email: string | null }>);
    return subs.filter(s => allowedIds.has(s.athlete_id));
  } catch {
    return subs; // fail open
  }
}

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@madregot.club', pub, priv);
  configured = true;
  return true;
}

// Toggleable notification categories (per-user prefs). A payload's category lets
// sendPushToSubscriptions drop athletes who muted it. Omit category → always sent
// (e.g. critical/admin messages that shouldn't be silenceable).
export type NotificationCategory = 'workouts' | 'coach' | 'achievements' | 'program' | 'teammates' | 'news' | 'events';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  badge?: number; // app-icon badge count (iOS 16.4+ installed PWA). Defaults to 1.
  category?: NotificationCategory; // which pref governs this push (unset = always send)
  /**
   * Small square avatar/photo shown next to the notification (e.g. a coach's
   * profile photo), matching how Strava shows a relevant image per notification
   * instead of just the app icon. Falls back to the app icon in sw.ts when unset
   * — optional so every existing call site keeps working unchanged.
   */
  icon?: string;
  /** Larger banner image shown inside an expanded notification. Optional, rarely set today. */
  image?: string;
  /**
   * When true, re-alerts (sound/vibration) even though this delivery reuses an
   * existing `tag` and therefore replaces a notification already on screen —
   * for cases like a recurring reminder where the replacement should still
   * ping the user, not just silently swap the old card's content.
   */
  renotify?: boolean;
  /**
   * OS-level action buttons on the notification itself (Chrome/Android +
   * desktop; iOS/WebKit doesn't support the Notification actions API and
   * silently ignores this — the in-app inbox is the fallback for those
   * platforms). `action` must match a case sw.ts's notificationclick handles.
   */
  actions?: Array<{ action: string; title: string }>;
  /** Context for the SW's 'rsvp_yes'/'rsvp_no' action handlers. */
  rsvp?: { weekStart: string; day: number };
  /** Context for the SW's 'kudos' action handler. */
  kudosActivityId?: string;
}

// The scope an action button on this payload is allowed to act within, or null
// when the payload has no buttons that hit the API. Derived from the payload
// rather than passed in, so a caller can't accidentally mint a wider token than
// the notification it's attached to.
//
// Exported for the test that pins this to the scope each route recomputes on the
// way back in: if the two ever disagree the button fails with a perfectly valid
// token, which is the one failure mode neither side can catch alone.
export function actionScopeFor(payload: PushPayload): string | null {
  if (payload.rsvp) return rsvpScope(payload.rsvp.weekStart, payload.rsvp.day);
  if (payload.kudosActivityId) return kudosScope(payload.kudosActivityId);
  return null;
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string; athlete_id: string };

/**
 * Given athlete rows (id + their saved notification_prefs) and a category,
 * returns the set of athlete ids who have explicitly muted it. A missing
 * prefs object, or a missing key within it, means opted IN — only an
 * explicit `false` mutes. Pure — filterByCategory below does the DB fetch.
 */
export function computeMutedAthleteIds(
  athleteRows: Array<{ id: string; notification_prefs?: Record<string, boolean> | null }>,
  category: NotificationCategory,
): Set<string> {
  return new Set(
    athleteRows
      .filter((a) => a.notification_prefs && a.notification_prefs[category] === false)
      .map((a) => a.id),
  );
}

/**
 * Drop subscriptions whose athlete has muted this notification category. A
 * missing prefs column, missing athlete row, or missing key = opted IN (default
 * is receive-everything), so nothing is silenced unless explicitly turned off.
 * Fails OPEN (returns subs unchanged) on any error.
 */
async function filterByCategory(subs: SubRow[], category?: NotificationCategory): Promise<SubRow[]> {
  if (!category || subs.length === 0) return subs;
  try {
    const supabase = createServerClient();
    const ids = [...new Set(subs.map(s => s.athlete_id).filter(Boolean))];
    const { data, error } = await supabase.from('athletes').select('id, notification_prefs').in('id', ids);
    if (error) return subs; // column not migrated yet → everyone opted in
    const muted = computeMutedAthleteIds((data || []) as Array<{ id: string; notification_prefs?: Record<string, boolean> | null }>, category);
    if (muted.size === 0) return subs;
    return subs.filter(s => !muted.has(s.athlete_id));
  } catch {
    return subs; // fail open
  }
}

/**
 * Per-athlete unread count = notifications sent to this athlete since they last
 * opened the app (athletes.last_seen_at, updated by /api/auth/me on open). This
 * makes the app-icon badge behave like a normal app: it climbs with each new
 * notification and resets when the athlete opens the app. Returns a map
 * athlete_id -> unread count (already including the notification being sent now).
 */
// Was N athletes x 2 sequential DB round trips (one per athlete via
// unreadCountForAthlete) — invisible at a handful of test subscribers, but a
// real bottleneck (and connection-pool risk) once a broadcast reaches 100+
// real athletes. Batched to exactly 2 queries total regardless of audience
// size: one for every recipient's group_id/last_seen_at, one for every
// recently-sent notification, then the per-athlete match happens in memory.
/**
 * Does this sent notification count toward this athlete's unread total? True
 * when it was sent after `since` AND targets them — broadcast to everyone, to
 * their group specifically, or to them by id. Pure — the single audience-
 * matching rule shared by the badge count and the inbox history, so a bug
 * here can't silently leak a group's notifications to the wrong group (or
 * hide real ones) in just one of the two call sites.
 */
export function matchesAudience(
  notif: { audience_type: string; audience_id: string | null; last_sent_at: string },
  athlete: { group_id: string | null },
  athleteId: string,
  since: string,
): boolean {
  if (notif.last_sent_at <= since) return false;
  return (
    notif.audience_type === 'all' ||
    (notif.audience_type === 'group' && notif.audience_id === athlete.group_id) ||
    (notif.audience_type === 'athlete' && notif.audience_id === athleteId)
  );
}

async function computeUnreadCounts(athleteIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (athleteIds.length === 0) return counts;
  const supabase = createServerClient();

  const { data: athletesData } = await supabase
    .from('athletes')
    .select('id, group_id, last_seen_at')
    .in('id', athleteIds);
  const athleteById = new Map((athletesData || []).map((a: { id: string; group_id: string | null; last_seen_at: string | null }) => [a.id, a]));

  const earliestSince = (athletesData || []).reduce(
    (min: string, a: { last_seen_at: string | null }) => {
      const since = a.last_seen_at || '1970-01-01';
      return since < min ? since : min;
    },
    '9999-12-31',
  );
  const { data: recentNotifs } = await supabase
    .from('scheduled_notifications')
    .select('audience_type, audience_id, last_sent_at')
    .eq('status', 'sent')
    .gt('last_sent_at', earliestSince);

  for (const id of athleteIds) {
    const a = athleteById.get(id);
    if (!a) { counts[id] = 1; continue; }
    const since = a.last_seen_at || '1970-01-01';
    let count = 0;
    for (const n of (recentNotifs || []) as Array<{ audience_type: string; audience_id: string | null; last_sent_at: string }>) {
      if (matchesAudience(n, a, id, since)) count++;
    }
    // +1 for the notification being delivered right now (send path).
    counts[id] = count + 1;
  }
  return counts;
}

/**
 * The athlete's current unread notification count = notifications targeting them
 * (all / their group / them) sent since their last app open (last_seen_at).
 * Used for the foreground badge self-heal. Exported for the badge-count route.
 */
export async function unreadCountForAthlete(athleteId: string): Promise<number> {
  const supabase = createServerClient();
  const { data: a } = await supabase
    .from('athletes')
    .select('group_id, last_seen_at')
    .eq('id', athleteId)
    .maybeSingle();
  if (!a) return 0;
  const since = a.last_seen_at || '1970-01-01';
  const orClause = [
    'audience_type.eq.all',
    a.group_id ? `and(audience_type.eq.group,audience_id.eq.${a.group_id})` : null,
    `and(audience_type.eq.athlete,audience_id.eq.${athleteId})`,
  ].filter(Boolean).join(',');
  const { count } = await supabase
    .from('scheduled_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gt('last_sent_at', since)
    .or(orClause);
  return count || 0;
}

/**
 * Send a push payload to a set of subscriptions. Dead subscriptions (404/410)
 * are pruned. Returns how many were delivered.
 *
 * Thin wrapper over sendPushDetailed for the many callers that only need the
 * total. Prefer sendPushDetailed for fan-outs, where a single total says
 * nothing about which recipient actually got anything.
 */
export async function sendPushToSubscriptions(subs: SubRow[], payload: PushPayload): Promise<number> {
  const { sent } = await sendPushDetailed(subs, payload);
  return sent;
}

/**
 * Send a push payload and report, per athlete, how many of their devices it
 * actually reached.
 *
 * Every early return and every swallowed error in here used to be completely
 * silent — no log line, no counter, no status change anywhere — while
 * persistNotifications simultaneously wrote `status:'sent', sent_count:1` for
 * each recipient regardless. A morning where 260 teammate notifications
 * reached zero phones was therefore indistinguishable, from any record the app
 * kept, from a morning where they all arrived. Every `return 0` below now says
 * why, and the real per-athlete count is handed back so the persisted rows can
 * tell the truth.
 */
export async function sendPushDetailed(
  subs: SubRow[],
  payload: PushPayload,
): Promise<{ sent: number; byAthlete: Record<string, number> }> {
  const empty = { sent: 0, byAthlete: {} as Record<string, number> };
  if (subs.length === 0) return empty;
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID keys missing — dropped "${payload.title}" for ${subs.length} subscription(s)`);
    return empty;
  }
  const supabase = createServerClient();

  // While maintenance mode is ON, only the allowlist (+ approvers) may receive
  // ANY push — everyone else is walled off from the app, so don't nag them.
  const beforeMaintenance = subs.length;
  subs = await filterForMaintenance(subs);
  if (subs.length === 0) {
    console.warn(`[push] maintenance allowlist dropped all ${beforeMaintenance} subscription(s) for "${payload.title}"`);
    return empty;
  }

  // Respect each athlete's per-category notification preference (default: on).
  const beforeCategory = subs.length;
  subs = await filterByCategory(subs, payload.category);
  if (subs.length === 0) {
    console.warn(`[push] category "${payload.category}" muted by all ${beforeCategory} recipient(s) of "${payload.title}"`);
    return empty;
  }

  // Badge is a per-athlete unread count (unless the caller pinned one explicitly).
  const athleteIds = [...new Set(subs.map((s) => s.athlete_id).filter(Boolean))];
  const unread = payload.badge != null ? {} : await computeUnreadCounts(athleteIds);

  let sent = 0;
  const byAthlete: Record<string, number> = {};
  const deadIds: string[] = [];
  const okIds: string[] = [];
  const failures: string[] = [];
  const scope = actionScopeFor(payload);

  await Promise.all(
    subs.map(async (s) => {
      // Each athlete's devices get that athlete's own badge count + their own
      // athleteId, so an OS-level notification action (which runs in the SW,
      // with no page/localStorage to read from) knows who's acting.
      const badge = payload.badge != null ? payload.badge : (unread[s.athlete_id] ?? 1);
      // …and, when the notification has action buttons, that athlete's own
      // signed authorization to press them. Minted per recipient here because
      // this is the only point that knows who the payload is going to, so a
      // token can never authorize anyone but the device that received it.
      const actionToken = scope ? signActionToken(s.athlete_id, scope) : null;
      const body = JSON.stringify({
        ...payload,
        badge,
        athleteId: s.athlete_id,
        ...(actionToken ? { actionToken } : {}),
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
        byAthlete[s.athlete_id] = (byAthlete[s.athlete_id] || 0) + 1;
        okIds.push(s.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) deadIds.push(s.id);
        // other errors (network/timeout): leave the subscription in place, but
        // say so. These were swallowed entirely, which meant an expired VAPID
        // key (401/403), an oversized payload (413), or push-service rate
        // limiting (429) all looked exactly like a normal quiet morning.
        else failures.push(`${s.endpoint.slice(0, 40)}…=${status ?? (err as Error)?.message ?? 'unknown'}`);
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds);
  }

  // Mark the endpoints the push service accepted. Until now `last_success_at`
  // was written once at subscribe time and never again — a name that promised
  // delivery evidence while holding none.
  //
  // Read it as "the push service took a push for this endpoint", NOT "a device
  // displayed it": Apple returns 201 for an endpoint that is still registered
  // but no longer bound to a live service worker, so a ghost endpoint gets
  // stamped here exactly like a working one. That's precisely why retiring
  // superseded endpoints is driven by the client naming them
  // (`replacesEndpoint` in /api/push/subscribe) rather than by this column.
  if (okIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ last_success_at: new Date().toISOString() })
      .in('id', okIds);
  }

  if (failures.length > 0) {
    console.warn(`[push] "${payload.title}": ${failures.length}/${subs.length} failed — ${failures.join(', ')}`);
  }
  if (sent === 0) {
    console.warn(`[push] "${payload.title}": reached 0 of ${subs.length} subscription(s) (${deadIds.length} pruned as dead)`);
  }
  return { sent, byAthlete };
}

/**
 * Resolve an audience descriptor to the set of push subscriptions to send to.
 * 'all' = every athlete of the club; 'group' = athletes in a group;
 * 'athlete' = a single athlete. Returns [] on unknown input.
 */
export async function resolveAudience(
  audienceType: string,
  audienceId: string | null,
): Promise<SubRow[]> {
  const supabase = createServerClient();

  let athleteIds: string[] = [];
  if (audienceType === 'athlete' && audienceId) {
    athleteIds = [audienceId];
  } else if (audienceType === 'group' && audienceId) {
    const { data } = await supabase.from('athletes').select('id').eq('group_id', audienceId);
    athleteIds = (data || []).map((a) => a.id);
  } else if (audienceType === 'all') {
    const { data } = await supabase.from('athletes').select('id').eq('coach_id', COACH_ID);
    athleteIds = (data || []).map((a) => a.id);
  }

  if (athleteIds.length === 0) return [];
  return subscriptionsForAthletes(athleteIds);
}

/** Push subscriptions for an explicit list of athlete ids (e.g. RSVP non-responders). */
export async function subscriptionsForAthletes(athleteIds: string[]): Promise<SubRow[]> {
  if (athleteIds.length === 0) return [];
  const supabase = createServerClient();
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, athlete_id')
    .in('athlete_id', athleteIds);
  return (subs || []) as SubRow[];
}

/**
 * Notify an athlete's followers (everyone with an athlete_follows row where
 * followee_id = this athlete — see migration 060) that they just finished a
 * run. Title is deliberately just name + verb (no distance) so it never
 * truncates on a lock screen; the body is just the km — full stats (pace,
 * duration, HR) are a tap away on the activities feed, not worth the noise
 * in the notification itself. This is deliberately scoped to "friends I
 * follow", not the athlete's training group: follow is opt-in per-person, so
 * it's a much more relevant audience than everyone who happens to share a
 * pace group.
 * Call this ONLY right after a genuinely NEW athlete_activities row is
 * inserted (never on a re-sync of an activity already known — see the
 * Strava/Garmin sync-activities routes for how "new" is determined there).
 *
 * No-op if the athlete has no followers, or no follower has a push
 * subscription. Each follower's 'teammates' mute preference is respected
 * automatically via sendPushToSubscriptions — callers do not need a separate
 * mute check. Callers MUST wrap this call in try/catch: a push failure here
 * must never break the activity sync that triggered it.
 */
export async function notifyTeammatesOfActivity(activity: {
  athleteId: string;
  /** Unique per activity — keys the notification `tag` so it can't duplicate. */
  activityKey: string | number;
  /** The real athlete_activities.id (UUID) — lets a follower give kudos directly from this notification. */
  activityId: string;
  distanceMeters: number;
}): Promise<number> {
  const supabase = createServerClient();
  const { data: athlete } = await supabase
    .from('athletes')
    .select('name, gender, avatar_url')
    .eq('id', activity.athleteId)
    .maybeSingle();
  if (!athlete) return 0;

  const { data: followerLinks } = await supabase
    .from('athlete_follows')
    .select('follower_id')
    .eq('followee_id', activity.athleteId);
  const followerIds = (followerLinks || []).map((f: { follower_id: string }) => f.follower_id);
  if (followerIds.length === 0) return 0;

  const subs = await subscriptionsForAthletes(followerIds);
  if (subs.length === 0) return 0;

  const km = (activity.distanceMeters / 1000).toFixed(1);

  const name = (athlete.name || '').trim() || 'חבר/ה לקבוצה';
  // Gender-neutral fallback when the athlete hasn't filled in their gender
  // (migration 057, optional field) — otherwise a natural gendered verb.
  const verb = athlete.gender === 'male' ? 'סיים' : athlete.gender === 'female' ? 'סיימה' : 'סיים/ה';
  const title = `🏃 ${name} ${verb} ריצה`;
  const body = `${km} ק"מ`;
  // No teammate-visible activity-detail page exists yet (the per-activity
  // run-chat link is owner/coach-only — canAccessChat in
  // src/lib/run-chat/access.ts 403s any other athlete), so this falls back to
  // the shared activities feed — but carries the real activity id as a query
  // param so the notification row itself can offer a "give kudos" action
  // without needing that detail page at all.
  const url = `/dashboard/activities?kudos=${activity.activityId}`;

  // Send BEFORE persisting — same reasoning as notifyAthlete: computeUnreadCounts
  // (inside sendPushToSubscriptions) adds +1 per recipient for "the notification
  // being delivered right now", assuming its row isn't in the DB yet. Persisting
  // first would double-count it and inflate every follower's app-icon badge by 1.
  const { sent, byAthlete } = await sendPushDetailed(subs, {
    // Distance is in the TITLE itself, not just the body — iOS shows the
    // title even when a locked-screen preview or notification summary
    // collapses/hides the body line, so the km can't get lost the way a
    // bare "X finished a run" title did before.
    title,
    body,
    url,
    tag: `teammate-activity-${activity.activityKey}`,
    category: 'teammates',
    actions: [{ action: 'kudos', title: '👍 קודוס' }],
    kudosActivityId: activity.activityId,
    // `icon` (small, corner badge) works broadly incl. iOS 16.4+ PWA push;
    // `image` (large expanded banner) is Chrome/Android-only today — iOS's
    // Web Push notification API doesn't render it regardless of what's sent,
    // a platform limitation, not something fixable from here. Both point at
    // the same photo so it shows as richly as each platform allows.
    ...(athlete.avatar_url ? { icon: athlete.avatar_url, image: athlete.avatar_url } : {}),
  });

  // Persist one row per follower (not just push) so this shows up in each
  // follower's Notification Center history afterward, same as any other
  // social-activity notification — best-effort, never blocks/undoes the push above.
  // byAthlete is threaded through so a row that reached nobody records 0 rather
  // than claiming a delivery: this exact fan-out is the one that wrote 260
  // "sent" rows for a morning where every single push was silently discarded.
  await persistNotifications(followerIds.map((followerId) => ({
    athleteId: followerId,
    kind: 'kudos_activity',
    actorAthleteId: activity.athleteId,
    title,
    body,
    url,
  })), byAthlete);

  return sent;
}

/**
 * Persist one scheduled_notifications row per recipient — for fan-out cases
 * (one event, several recipients — e.g. every follower of an athlete who just
 * ran, or every coach when an order comes in) where the actual push is
 * already sent as one batched sendPushDetailed call. Best-effort, never throws.
 *
 * Pass `sentByAthlete` (sendPushDetailed's second return value) so each row
 * records how many of THAT recipient's devices the push actually reached. This
 * used to hardcode `sent_count: 1` for every row, which is how 260 rows came to
 * claim they'd been delivered on a morning when not one of them arrived. With
 * the map supplied, 0 means "we have a record of this notification but no
 * device took it" — an honest answer the history could not previously give.
 * Omitting the map keeps the old optimistic 1 for callers that genuinely don't
 * know their per-recipient split.
 */
export async function persistNotifications(
  rows: Array<{
    athleteId: string;
    kind: string;
    actorAthleteId?: string | null;
    title: string;
    body: string;
    url: string;
  }>,
  sentByAthlete?: Record<string, number>,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const supabase = createServerClient();
    await supabase.from('scheduled_notifications').insert(
      rows.map((r) => ({
        kind: r.kind,
        title_he: r.title,
        body_he: r.body,
        url: r.url,
        audience_type: 'athlete',
        audience_id: r.athleteId,
        actor_athlete_id: r.actorAthleteId || null,
        schedule_type: 'now',
        status: 'sent',
        last_sent_at: new Date().toISOString(),
        sent_count: sentByAthlete ? (sentByAthlete[r.athleteId] ?? 0) : 1,
      })),
    );
  } catch { /* best-effort */ }
}

/**
 * Notify one athlete about something a specific person (or the system) did —
 * persists a row to scheduled_notifications (audience_type='athlete') AND
 * sends the push, in one call, so every social-activity notification (like,
 * comment, follow, badge, coach reply) is durably visible in the in-app
 * Notification Center afterward, not just a fire-and-forget push that vanishes
 * the moment it's dismissed or missed. Both halves are independently
 * best-effort — a failure in one never blocks the other or the caller.
 */
export async function notifyAthlete(opts: {
  athleteId: string;
  /** Free-text category for this row's `kind` column, e.g. 'like' | 'comment' | 'badge' | 'follow' | 'feedback_reply'. */
  kind: string;
  /** Who did this to the recipient — null for system-generated (e.g. a badge award). */
  actorAthleteId?: string | null;
  title: string;
  body: string;
  url: string;
  tag?: string;
  category?: NotificationCategory;
  icon?: string;
}): Promise<void> {
  // Send BEFORE persisting: computeUnreadCounts (inside sendPushToSubscriptions)
  // counts already-'sent' rows since last_seen_at and adds +1 for "the one being
  // delivered right now" — that +1 assumes this row isn't in the DB yet. Persisting
  // first would make the row match the same query, double-counting it and
  // inflating the OS app-icon badge by 1 on every call.
  let byAthlete: Record<string, number> | undefined;
  try {
    const subs = await subscriptionsForAthletes([opts.athleteId]);
    if (subs.length > 0) {
      ({ byAthlete } = await sendPushDetailed(subs, {
        title: opts.title,
        body: opts.body,
        url: opts.url,
        tag: opts.tag,
        category: opts.category,
        ...(opts.icon ? { icon: opts.icon } : {}),
      }));
    } else {
      // No subscription at all: the row below is inbox-only by definition, and
      // saying so beats recording a phantom delivery.
      byAthlete = {};
    }
  } catch { /* push is best-effort — leave byAthlete undefined (unknown) */ }

  await persistNotifications([{
    athleteId: opts.athleteId,
    kind: opts.kind,
    actorAthleteId: opts.actorAthleteId,
    title: opts.title,
    body: opts.body,
    url: opts.url,
  }], byAthlete);
}

/** All athlete ids of the club (for computing non-responders). */
export async function allAthleteIds(): Promise<string[]> {
  const supabase = createServerClient();
  const { data } = await supabase.from('athletes').select('id').eq('coach_id', COACH_ID);
  return (data || []).map((a: { id: string }) => a.id);
}
