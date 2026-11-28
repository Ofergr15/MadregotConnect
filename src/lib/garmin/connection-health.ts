/**
 * Club-wide Garmin credential health, for the staff health API (task 191).
 *
 * The per-athlete verdict is lib/providers/health's `connectionState`, fed by the
 * two migration-101 stamps the sync writes: `garmin_auth_failed_at` when Garmin
 * refuses the stored credential (the token refresh / exchange answered 401/403 or
 * "invalid grant"), `garmin_last_sync_at` on every good pass. That is the only
 * reliable "expired" signal: the stored OAuth2 access token is re-minted from the
 * OAuth1 token on every client load, and the OAuth1 token carries no expiry, so
 * reading expiry fields out of the decrypted blob would answer nothing — and keep
 * the credential out of this code path entirely.
 *
 * Pure: no database, no clock except the `now` passed in.
 */
import { connectionState, type ConnectionState } from '@/lib/providers/health';
import type { NotificationLocale } from '@/lib/notifications/locale';

export interface GarminHealthRow {
  id: string;
  name: string | null;
  hasAuth: boolean;
  garmin_last_sync_at: string | null;
  garmin_auth_failed_at: string | null;
}

export interface GarminHealthEntry {
  athleteId: string;
  name: string | null;
  state: ConnectionState;
  lastSyncAt: string | null;
  /** When Garmin first refused (only for `failed`). */
  failedAt: string | null;
}

export type GarminHealthCounts = Record<Exclude<ConnectionState, 'none'>, number>;

/** Where the member reconnects: the profile's data-source tab (same target as the watch-disconnected push). */
export const GARMIN_RECONNECT_URL = '/dashboard/profile?tab=datasource';
export const GARMIN_RECONNECT_KIND = 'garmin_reconnect';

export interface ReconnectPrompt {
  kind: typeof GARMIN_RECONNECT_KIND;
  title: string;
  body: string;
  url: string;
}

/**
 * The reconnect prompt, ready for a push / in-app card. BUILT, NEVER SENT here:
 * the staff screen decides whether to nudge. Names the consequence (runs stop
 * arriving) and the one action, like watchDisconnectedCopy does.
 */
export function garminReconnectPrompt(locale: NotificationLocale): ReconnectPrompt {
  const copy = locale === 'he'
    ? { title: '⌚ צריך לחבר מחדש את גרמין', body: 'גרמין הפסיק לקבל את החיבור, ולכן הריצות שלך לא מגיעות. חיבור מחדש לוקח דקה.' }
    : { title: '⌚ Reconnect Garmin', body: 'Garmin stopped accepting the connection, so your runs aren’t arriving. Reconnecting takes a minute.' };
  return { kind: GARMIN_RECONNECT_KIND, url: GARMIN_RECONNECT_URL, ...copy };
}

export function classifyGarminHealth(rows: GarminHealthRow[], now: number = Date.now()): {
  counts: GarminHealthCounts;
  failed: GarminHealthEntry[];
  stale: GarminHealthEntry[];
} {
  const counts: GarminHealthCounts = { ok: 0, stale: 0, failed: 0, unknown: 0 };
  const failed: GarminHealthEntry[] = [];
  const stale: GarminHealthEntry[] = [];
  for (const r of rows) {
    const state = connectionState(
      { hasAuth: r.hasAuth, lastSyncAt: r.garmin_last_sync_at, authFailedAt: r.garmin_auth_failed_at },
      now,
    );
    if (state === 'none') continue;
    counts[state] += 1;
    const entry: GarminHealthEntry = {
      athleteId: r.id,
      name: r.name,
      state,
      lastSyncAt: r.garmin_last_sync_at,
      failedAt: state === 'failed' ? r.garmin_auth_failed_at : null,
    };
    if (state === 'failed') failed.push(entry);
    else if (state === 'stale') stale.push(entry);
  }
  // Longest-broken first: the member who has been missing runs the longest.
  const at = (s: string | null) => (s ? Date.parse(s) : 0);
  failed.sort((a, b) => at(a.failedAt) - at(b.failedAt) || a.athleteId.localeCompare(b.athleteId));
  stale.sort((a, b) => at(a.lastSyncAt) - at(b.lastSyncAt) || a.athleteId.localeCompare(b.athleteId));
  return { counts, failed, stale };
}
