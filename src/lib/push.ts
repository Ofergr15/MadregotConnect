import webpush from 'web-push';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

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
  const supabase = createServerClient();
  const counts: Record<string, number> = {};
  // Pull each athlete's last_seen_at + group, then count matching sent rows.
  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, group_id, last_seen_at')
    .in('id', athleteIds);

  await Promise.all(
    (athletes || []).map(async (a: { id: string; group_id: string | null; last_seen_at: string | null }) => {
      const since = a.last_seen_at || '1970-01-01';
      // Notifications targeting this athlete (all / their group / them) sent since last open.
      const orClause = [
        'audience_type.eq.all',
        a.group_id ? `and(audience_type.eq.group,audience_id.eq.${a.group_id})` : null,
        `and(audience_type.eq.athlete,audience_id.eq.${a.id})`,
      ].filter(Boolean).join(',');
      const { count } = await supabase
        .from('scheduled_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gt('last_sent_at', since)
        .or(orClause);
      // +1 for the notification being delivered right now.
      counts[a.id] = (count || 0) + 1;
    }),
  );
  return counts;
}

/**
 * Send a push payload to a set of subscriptions. Dead subscriptions (404/410)
 * are pruned. Returns how many were delivered.
 */
export async function sendPushToSubscriptions(subs: SubRow[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured() || subs.length === 0) return 0;
  const supabase = createServerClient();

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

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, athlete_id')
    .in('athlete_id', athleteIds);

  return (subs || []) as SubRow[];
}
