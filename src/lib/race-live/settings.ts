/**
 * RACE SETTINGS (round 6, task 148). The three times that run race morning, per event:
 *
 *   start   — the gun (race_live_config.race_start_at, migration 320)
 *   pollFrom / pollTo — the race window: positions accepted and shown, the feed polled (196)
 *
 * Rules (pure, every one is a test):
 *   - every time is ISO-8601 WITH an explicit offset ("2026-12-06T08:15:00+01:00" or "…Z"). A bare
 *     "08:15" or "2026-12-06T08:15" is refused: the admin is in Israel, the race is in Spain, and a
 *     time without a zone is read in whichever zone the server runs in.
 *   - pollFrom ≤ start, and no more than 12 h before it (phones share from the corral, not overnight);
 *   - pollTo ≥ start + 6:30 (the slowest club runner still on course; the board must not close on them),
 *     and no more than 24 h after the start;
 *   - the start falls on the event's date (±1 day: Valencia's 08:15 CET is 07:15 UTC, a late-night race
 *     in another zone may cross midnight).
 *
 * A partial update is validated MERGED with what is stored, so moving only the start re-checks the window.
 */

export const MIN_WINDOW_AFTER_START_MS = (6 * 60 + 30) * 60 * 1000;
export const MAX_LEAD_BEFORE_START_MS = 12 * 3600 * 1000;
export const MAX_WINDOW_AFTER_START_MS = 24 * 3600 * 1000;

export interface RaceSettings { startAt: string | null; pollFrom: string | null; pollTo: string | null }
export type SettingsField = 'startAt' | 'pollFrom' | 'pollTo';
export type SettingsError =
  | { error: 'bad-time'; field: SettingsField }
  | { error: 'missing'; field: SettingsField }
  | { error: 'poll-from-after-start' | 'poll-from-too-early' | 'poll-to-too-soon' | 'poll-to-too-late' | 'start-not-on-event-date' };

// Date + time + optional fraction + an explicit zone (Z or ±hh:mm).
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A zoned ISO string → canonical UTC ISO, or null. */
export function parseZonedIso(v: unknown): string | null {
  if (typeof v !== 'string' || !ISO_WITH_ZONE.test(v.trim())) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The body's fields (only those present). `null` clears a field; anything else must parse. */
export function parseSettingsBody(body: unknown): { patch: Partial<RaceSettings> } | SettingsError {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<RaceSettings> = {};
  for (const field of ['startAt', 'pollFrom', 'pollTo'] as const) {
    if (!(field in b)) continue;
    if (b[field] === null) { patch[field] = null; continue; }
    const iso = parseZonedIso(b[field]);
    if (!iso) return { error: 'bad-time', field };
    patch[field] = iso;
  }
  return { patch };
}

/** Validate the merged settings. `eventDate` = events.date ('YYYY-MM-DD'), when known. */
export function validateRaceSettings(s: RaceSettings, eventDate: string | null): SettingsError | null {
  for (const field of ['startAt', 'pollFrom', 'pollTo'] as const) if (!s[field]) return { error: 'missing', field };
  const start = Date.parse(s.startAt!), from = Date.parse(s.pollFrom!), to = Date.parse(s.pollTo!);
  if (from > start) return { error: 'poll-from-after-start' };
  if (start - from > MAX_LEAD_BEFORE_START_MS) return { error: 'poll-from-too-early' };
  if (to < start + MIN_WINDOW_AFTER_START_MS) return { error: 'poll-to-too-soon' };
  if (to - start > MAX_WINDOW_AFTER_START_MS) return { error: 'poll-to-too-late' };
  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const day = Date.parse(`${eventDate}T00:00:00Z`);
    // The start's UTC instant within [event day − 1 day, event day + 2 days) covers every zone.
    if (start < day - 86_400_000 || start >= day + 2 * 86_400_000) return { error: 'start-not-on-event-date' };
  }
  return null;
}

/** "08:15" in a given IANA zone — for the response, so the admin sees what they set in both zones. */
export function clockIn(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
