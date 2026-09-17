import { getStreamServerClient } from './server';

// ── Chat unread, for the app badge ──────────────────────────────────────────
//
// Until this module, a chat message badged NOTHING. The app-icon badge and the
// in-app bell both count rows in `scheduled_notifications`, and no chat message has
// ever written one — run chats send no notifications at all. So the club's two
// conversation surfaces were the only things in the app that could not get your
// attention, which for the academy thread defeats the point of moving off WhatsApp.
//
// STREAM IS THE AUTHORITY here, not a notification row, and that is the whole design
// decision. Read state changes when somebody reads — on another device, in a browser
// tab, five minutes later — and Stream is the only thing that knows. A row-based
// count would have to guess, and a badge that guesses high is a badge people learn
// to ignore. The corollary is in `countsTowardBadge`: kinds that land in a Stream
// channel are excluded from the row count, so the two never both count the same
// message.

/** Never throws and never guesses: an unreachable Stream contributes 0. */
export async function streamUnreadForAthlete(athleteId: string): Promise<number> {
  if (!athleteId) return 0;
  try {
    const { total_unread_count } = await getStreamServerClient().getUnreadCount(athleteId);
    return total_unread_count ?? 0;
  } catch (err) {
    // Fails to 0 rather than propagating: this is one addend of a badge count, and a
    // Stream outage must not take the notification half of the number down with it.
    console.error('streamUnreadForAthlete failed:', err);
    return 0;
  }
}

/**
 * The same for many athletes, in ONE call.
 *
 * Used on the send path, which computes a badge for every recipient of a broadcast —
 * twenty sequential round trips there would put Stream's latency inside the club's
 * push delivery. Missing athletes are simply absent from the map, and callers treat
 * absent as 0.
 */
export async function streamUnreadForAthletes(athleteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(athleteIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const { counts_by_user } = await getStreamServerClient().getUnreadCountBatch(ids);
    for (const [id, counts] of Object.entries(counts_by_user || {})) {
      out.set(id, counts?.total_unread_count ?? 0);
    }
  } catch (err) {
    console.error('streamUnreadForAthletes failed:', err);
  }
  return out;
}
