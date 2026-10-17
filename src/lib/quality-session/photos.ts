// Photos from a quality session (#106, mockup ~/.cache/madregot/feed-photos-106/mockup-v2.html).
//
// No album system: the photographer already has the photos in Drive / Google
// Photos / a WhatsApp album. After the session, whoever runs the quality-session
// screen pastes that link, optionally picks up to six photos for the feed, and
// publishes ONE feed card for the day. It is an `announcement` row (no migration):
// author null (it is the club's), payload.kind = 'session_photos'.

export const SESSION_PHOTOS_KIND = 'session_photos';
export const MAX_SESSION_PHOTOS = 6;
/** How long the card sits at the top of the feed after it is published; then it is just in the list. */
export const SESSION_PHOTOS_TOP_HOURS = 48;

export interface SessionPhotosPayload {
  kind: typeof SESSION_PHOTOS_KIND;
  /** The session's day, YYYY-MM-DD — one card per day. */
  date: string;
  /** The plan's name for the morning ("עליות"), when there is one. */
  workoutName: string | null;
  /** Where all the photos are. Always http(s). */
  link: string;
  /** Who published it; they and staff may change it. */
  byAthleteId: string | null;
}

/**
 * The link, if it is one a member can safely open: http(s) only, so a pasted
 * `javascript:` or `data:` string can never become the card's button.
 */
export function cleanPhotosLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The payload of a feed row, if it is a session-photos card. */
export function toSessionPhotos(payload: Record<string, unknown> | null | undefined): SessionPhotosPayload | null {
  if (!payload || payload.kind !== SESSION_PHOTOS_KIND) return null;
  const link = cleanPhotosLink(payload.link);
  const date = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : null;
  if (!link || !date) return null;
  return {
    kind: SESSION_PHOTOS_KIND,
    date,
    workoutName: typeof payload.workoutName === 'string' ? payload.workoutName : null,
    link,
    byAthleteId: typeof payload.byAthleteId === 'string' ? payload.byAthleteId : null,
  };
}

/** "שלישי 13.10" — the day the card is about. */
export function sessionDayLabel(date: string): string {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const d = new Date(`${date}T12:00:00Z`);
  return `${days[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

/**
 * The line under the card's title: the day, and the workout's name only when it
 * says more than the day — the plan names most sessions by their weekday
 * ("שלישי - בוקר"), and "שלישי 13.10 · שלישי - בוקר" says Tuesday twice.
 */
export function sessionSubline(date: string, workoutName: string | null): string {
  const day = sessionDayLabel(date);
  const name = workoutName?.trim();
  if (!name || name.startsWith(day.split(' ')[0])) return day;
  return `${day} · ${name}`;
}
