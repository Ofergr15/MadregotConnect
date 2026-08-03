import webpush from 'web-push';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID, APPROVER_EMAILS } from '@/lib/constants';

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
    const allowEmails = new Set([
      ...APPROVER_EMAILS.map(e => e.toLowerCase()),
      ...String(map['maintenance_allow'] || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
    ]);
    const ids = [...new Set(subs.map(s => s.athlete_id).filter(Boolean))];
    const { data: aths } = await supabase.from('athletes').select('id, email').in('id', ids);
    const allowedIds = new Set((aths || []).filter((a: { email: string }) => allowEmails.has((a.email || '').toLowerCase())).map((a: { id: string }) => a.id));
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

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  badge?: number; // app-icon badge count (iOS 16.4+ installed PWA). Defaults to 1.
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string; athlete_id: string };

/**
 * Per-athlete unread count = notifications sent to this athlete since they last
 * opened the app (athletes.last_seen_at, updated by /api/auth/me on open). This
 * makes the app-icon badge behave like a normal app: it climbs with each new
 * notification and resets when the athlete opens the app. Returns a map
 * athlete_id -> unread count (already including the notification being sent now).
 */
async function computeUnreadCounts(athleteIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(athleteIds.map(async (id) => {
    // +1 for the notification being delivered right now (send path).
    counts[id] = (await unreadCountForAthlete(id)) + 1;
  }));
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
 */
export async function sendPushToSubscriptions(subs: SubRow[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured() || subs.length === 0) return 0;
  const supabase = createServerClient();

  // While maintenance mode is ON, only the allowlist (+ approvers) may receive
  // ANY push — everyone else is walled off from the app, so don't nag them.
  subs = await filterForMaintenance(subs);
  if (subs.length === 0) return 0;

  // Badge is a per-athlete unread count (unless the caller pinned one explicitly).
  const athleteIds = [...new Set(subs.map((s) => s.athlete_id).filter(Boolean))];
  const unread = payload.badge != null ? {} : await computeUnreadCounts(athleteIds);

  let sent = 0;
  const deadIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      // Each athlete's devices get that athlete's own badge count.
      const badge = payload.badge != null ? payload.badge : (unread[s.athlete_id] ?? 1);
      const body = JSON.stringify({ ...payload, badge });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) deadIds.push(s.id);
        // other errors (network/timeout): leave the subscription in place
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds);
  }
  return sent;
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

/** All athlete ids of the club (for computing non-responders). */
export async function allAthleteIds(): Promise<string[]> {
  const supabase = createServerClient();
  const { data } = await supabase.from('athletes').select('id').eq('coach_id', COACH_ID);
  return (data || []).map((a: { id: string }) => a.id);
}
