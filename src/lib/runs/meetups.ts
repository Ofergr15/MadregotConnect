/**
 * Run meetups — the rules behind "שידוכי ריצות" (398963c7).
 *
 * Pure on purpose: every decision here is either caller-supplied input being
 * validated before it reaches a service-role write, or a date comparison. Both
 * are the parts where a wrong answer is invisible in a screenshot — a meetup that
 * quietly stays on the board after it happened, or a pace field that accepts
 * anything and then reads as garbage on somebody's card.
 *
 * No clock reads in here. The caller passes `today`, so the tests are not a
 * function of the day they run on, and the route can use Israel's calendar day
 * rather than the server's UTC one.
 */

export type MeetupStatus = 'open' | 'cancelled';
/** What kind of run it is — the card's first words (v2, migration 157). */
export type MeetupKind = 'easy' | 'long' | 'quality' | 'recovery';
export const MEETUP_KINDS: MeetupKind[] = ['easy', 'long', 'quality', 'recovery'];
export const KIND_LABEL: Record<MeetupKind, string> = { easy: 'קלה', long: 'ארוכה', quality: 'איכות', recovery: 'שחרור' };
/** Who is told about a new run: the host's own pack, or the whole club. Everyone can see it. */
export type MeetupAudience = 'pack' | 'club';

/**
 * Where the club starts from — the meeting points behind the post sheet's chips.
 * Picked from where club runs actually begin (athlete_activities start points,
 * Aug–Oct 2026: 15 runners at Gordon, 18 at Herzliya Park), checked on the map.
 * A host can always drop a pin anywhere else.
 */
export const CLUB_SPOTS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'טיילת גורדון', lat: 32.0852, lng: 34.7702 },
  { name: 'נמל תל אביב', lat: 32.0995, lng: 34.7742 },
  { name: 'פארק הירקון', lat: 32.0998, lng: 34.8115 },
  { name: 'פארק הרצליה', lat: 32.1655, lng: 34.8205 },
];
export type MeetupRequestStatus = 'pending' | 'accepted' | 'declined';

/** A member as a run shows them: a face, a first name, the pack colour. */
export interface MeetupPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** 1–3, the pack's colour (lib/utils GROUP_HEX); null when not in one. */
  pack: number | null;
}

/** A meetup as the API returns it — names and faces, never an email. */
export interface RunMeetup {
  id: string;
  host: MeetupPerson;
  date: string;
  startTime: string;
  location: string;
  lat: number | null;
  lng: number | null;
  kind: MeetupKind | null;
  plannedPace: string | null;
  distanceKm: number | null;
  notes: string | null;
  audience: MeetupAudience;
  /** The host's pack — the run's colour. */
  pack: number | null;
  /** Who is going: the host first, then everyone who joined. */
  going: MeetupPerson[];
  isHost: boolean;
  joined: boolean;
  messageCount: number;
}

/** `HH:MM`, 24-hour. The club writes "6:30" as often as "06:30", so both parse. */
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** `M:SS` per km. A pace of "12:00" is a walk and "2:30" is a world record, so the
 *  minutes are bounded too — a typo like "50:0" is worth refusing at the door. */
const PACE_RE = /^([2-9]|1[0-2]):([0-5]\d)$/;

/** Longest a member may look ahead. A meetup a month out is not a plan. */
export const MEETUP_HORIZON_DAYS = 21;
export const MAX_NOTES_LENGTH = 280;
export const MAX_LOCATION_LENGTH = 80;

export interface MeetupDraft {
  date?: unknown;
  startTime?: unknown;
  location?: unknown;
  plannedPace?: unknown;
  distanceKm?: unknown;
  notes?: unknown;
  kind?: unknown;
  lat?: unknown;
  lng?: unknown;
  audience?: unknown;
}

export interface ValidMeetup {
  date: string;
  startTime: string;
  location: string;
  plannedPace: string | null;
  distanceKm: number | null;
  notes: string | null;
  kind: MeetupKind | null;
  lat: number | null;
  lng: number | null;
  audience: MeetupAudience;
}

export type MeetupValidation =
  | { ok: true; value: ValidMeetup }
  | { ok: false; field: string; reason: string };

/**
 * Validate a create request.
 *
 * Returns the FIELD as well as the reason so the form can point at the thing that
 * is wrong; a single "invalid meetup" on a five-field sheet is a guessing game.
 * The optional fields normalise to null rather than to '' — a card should show no
 * pace row at all rather than an empty one.
 */
export function validateMeetupDraft(draft: MeetupDraft, today: string): MeetupValidation {
  const date = str(draft.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, field: 'date', reason: 'invalid' };
  if (date < today) return { ok: false, field: 'date', reason: 'past' };
  if (daysBetween(today, date) > MEETUP_HORIZON_DAYS) return { ok: false, field: 'date', reason: 'tooFar' };

  const startTime = str(draft.startTime);
  if (!TIME_RE.test(startTime)) return { ok: false, field: 'startTime', reason: 'invalid' };

  const location = str(draft.location);
  if (!location) return { ok: false, field: 'location', reason: 'required' };
  if (location.length > MAX_LOCATION_LENGTH) return { ok: false, field: 'location', reason: 'tooLong' };

  const paceRaw = str(draft.plannedPace);
  if (paceRaw && !PACE_RE.test(paceRaw)) return { ok: false, field: 'plannedPace', reason: 'invalid' };

  // A number, a numeric string from a form field, or nothing. Rejected rather
  // than clamped: silently turning 420 into 42 would send somebody to a run that
  // is not the one they read about.
  let distanceKm: number | null = null;
  if (draft.distanceKm !== undefined && draft.distanceKm !== null && draft.distanceKm !== '') {
    const n = Number(draft.distanceKm);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return { ok: false, field: 'distanceKm', reason: 'invalid' };
    distanceKm = Math.round(n * 100) / 100;
  }

  const notes = str(draft.notes).slice(0, MAX_NOTES_LENGTH);

  const kindRaw = str(draft.kind);
  if (kindRaw && !MEETUP_KINDS.includes(kindRaw as MeetupKind)) return { ok: false, field: 'kind', reason: 'invalid' };
  // A meeting point is both coordinates or neither, and somewhere in Israel's box —
  // a pin dropped by a stray tap in the sea off Cyprus is a typo, not a plan.
  const hasPoint = draft.lat !== undefined && draft.lat !== null && draft.lat !== '';
  const lat = hasPoint ? Number(draft.lat) : null;
  const lng = hasPoint ? Number(draft.lng) : null;
  if (hasPoint && !(Number.isFinite(lat) && Number.isFinite(lng) && lat! > 29 && lat! < 34 && lng! > 34 && lng! < 36)) {
    return { ok: false, field: 'location', reason: 'point' };
  }
  const audience: MeetupAudience = draft.audience === 'pack' ? 'pack' : 'club';

  return {
    ok: true,
    value: {
      date,
      // "6:30" and "06:30" are the same time; stored one way so the board sorts
      // as text without a surprise at the single-digit hours.
      startTime: startTime.padStart(5, '0'),
      location,
      plannedPace: paceRaw || null,
      distanceKm,
      notes: notes || null,
      kind: (kindRaw as MeetupKind) || null,
      lat: hasPoint ? Math.round(lat! * 1e5) / 1e5 : null,
      lng: hasPoint ? Math.round(lng! * 1e5) / 1e5 : null,
      audience,
    },
  };
}

const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** The board's day headings: "היום", "מחר", else the weekday — with the date beside it. */
export function dayHeading(date: string, today: string): { title: string; sub: string } {
  const d = daysBetween(today, date);
  const wd = WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const dm = `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
  if (d === 0) return { title: 'היום', sub: `${wd} ${dm}` };
  if (d === 1) return { title: 'מחר', sub: `${wd} ${dm}` };
  return { title: wd, sub: dm };
}

/** Group sorted meetups by date, in order. */
export function byDay<T extends { date: string }>(meetups: T[]): Array<{ date: string; items: T[] }> {
  const out: Array<{ date: string; items: T[] }> = [];
  for (const m of meetups) {
    const last = out[out.length - 1];
    if (last && last.date === m.date) last.items.push(m);
    else out.push({ date: m.date, items: [m] });
  }
  return out;
}

/** "5:10" from seconds per km. */
export function secondsToPace(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The viewer's usual pace: the median of their recent runs of 5–25 km — what "בקצב
 * שלך" compares a host's pace with, and what a new post starts from. Null without
 * enough runs to say.
 */
export function usualPace(runs: Array<{ distance: number; duration: number }>): string | null {
  const paces = runs
    .filter((r) => r.distance >= 5000 && r.distance <= 25000 && r.duration > 0)
    .map((r) => r.duration / (r.distance / 1000))
    .filter((p) => p >= 150 && p <= 600)
    .sort((a, b) => a - b);
  if (paces.length < 3) return null;
  return secondsToPace(paces[Math.floor(paces.length / 2)]);
}

/**
 * Is this meetup still worth showing?
 *
 * By DATE and not by date-plus-time: a run at 06:30 is still the answer to "what
 * is happening today" at 07:15, when the group is out and somebody is deciding
 * whether to chase them, and a board that dropped it at 06:31 would be empty
 * every morning at exactly the hour people look at it.
 */
export function isUpcomingMeetup(meetup: { date: string; status?: string }, today: string): boolean {
  if (meetup.status === 'cancelled') return false;
  return meetup.date >= today;
}

/** Soonest first, and within a day by clock time. */
export function sortMeetups<T extends { date: string; startTime: string }>(meetups: T[]): T[] {
  return [...meetups].sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date),
  );
}

/** "5:10" → 310 seconds per km. null for anything that isn't a pace. */
export function paceToSeconds(pace: string | null | undefined): number | null {
  const m = PACE_RE.exec((pace || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * How close two planned paces are, as a label the card can show.
 *
 * This is the "matchmaking" the report asks for, done honestly: the app does not
 * know what anybody's plan says (see the migration's note on parsed_workouts), so
 * it compares the pace the host WROTE against the pace the viewer wrote on their
 * own last offer, and says nothing at all when it has no basis for a claim.
 *
 * 15 s/km is the threshold. Two runners 15 seconds apart per kilometre finish a
 * 10K three and a half minutes apart, which is the same run; 30 seconds apart is
 * two runs that start together.
 */
export function paceMatch(hostPace: string | null | undefined, viewerPace: string | null | undefined): 'close' | 'near' | 'far' | null {
  const a = paceToSeconds(hostPace);
  const b = paceToSeconds(viewerPace);
  if (a === null || b === null) return null;
  const gap = Math.abs(a - b);
  if (gap <= 15) return 'close';
  if (gap <= 30) return 'near';
  return 'far';
}

/** YYYY-MM-DD plus n days. */
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Noon-anchored so DST can't shift it. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}
