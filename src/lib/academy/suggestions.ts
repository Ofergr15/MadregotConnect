// The academy home's smart suggestion (mockup academy-manager-v5.html, phones 1
// and 6): ONE thing to do next, highest priority first, each with a ⋯ that can
// snooze it until tomorrow or dismiss it for good.
//
//   pair     unpaired trainees + a coach with free seats → "לשבץ את X ו־Y אצל Z?"
//   write    a trainee who hasn't run for a while → "לכתוב ל־X"
//   resend   workouts that didn't reach the watch → to the watches tab
//
// Pure: the inputs are the payloads the home already has; the snooze/dismiss
// store is a plain object the component keeps in localStorage.

export interface CapacityCoach {
  coachId: string | null;
  coachName: string | null;
  trainees: number;
}

/** Seats left for a coach under the academy's per-coach capacity. */
export function freeSeats(coach: CapacityCoach, capacity: number): number {
  return Math.max(0, capacity - coach.trainees);
}

/**
 * The coach to recommend for `need` trainees: the most free seats among those
 * who can take all of them, else the most free seats of anyone with at least
 * one. Ties go to the lighter caseload, then the name, so it is stable.
 */
export function recommendCoach<C extends CapacityCoach>(coaches: C[], capacity: number, need = 1): C | null {
  const real = coaches.filter((c) => !!c.coachId && freeSeats(c, capacity) > 0);
  if (!real.length) return null;
  const order = (a: C, b: C) =>
    freeSeats(b, capacity) - freeSeats(a, capacity) || a.trainees - b.trainees
    || (a.coachName || '').localeCompare(b.coachName || '');
  const all = real.filter((c) => freeSeats(c, capacity) >= need).sort(order);
  return all[0] ?? real.sort(order)[0];
}

export type SuggestionKind = 'pair' | 'write' | 'resend';

export interface SuggestionPerson { id: string; name: string }

export interface Suggestion {
  /** Stable for the same situation — what snooze and dismiss are keyed on. */
  key: string;
  kind: SuggestionKind;
  title: string;
  sub: string;
  primary: string;
  people: SuggestionPerson[];
  coachId?: string;
  coachName?: string;
}

export interface SuggestionMember {
  athleteId: string;
  name: string;
  approved: boolean;
  academyCoachId: string | null;
  /** Every coach (migration 135); absent on an older payload = the legacy one. */
  academyCoachIds?: string[];
  academyJoinedOn: string | null;
  daysSinceActivity: number | null;
}

/** A trainee is suggested a message after this many days without a run. */
export const QUIET_DAYS = 7;

const first = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';
const daysSince = (day: string, today: string) =>
  Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day.slice(0, 10)}T12:00:00Z`)) / 86_400_000));

export function buildSuggestions({
  members, coaches, capacity, isManager, dispatch = [], today,
}: {
  members: SuggestionMember[];
  coaches: CapacityCoach[];
  capacity: number;
  /** Pairing is the manager's call; a coach only gets suggestions about their own trainees. */
  isManager: boolean;
  /** Dispatch rows the coach should act on, this week. */
  dispatch?: Array<{ athleteId: string; name: string }>;
  /** YYYY-MM-DD, Israel. */
  today: string;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const approved = members.filter((m) => m.approved);

  // (a) Pair the unpaired with the coach who has room.
  if (isManager) {
    const unpaired = approved
      // "Without a coach" = no coach at all; a shared trainee is paired twice over.
      .filter((m) => (m.academyCoachIds ?? (m.academyCoachId ? [m.academyCoachId] : [])).length === 0)
      .sort((a, b) => (a.academyJoinedOn || '').localeCompare(b.academyJoinedOn || '') || a.name.localeCompare(b.name));
    if (unpaired.length) {
      const coach = recommendCoach(coaches, capacity, Math.min(2, unpaired.length));
      if (coach?.coachId) {
        const take = unpaired.slice(0, Math.min(2, freeSeats(coach, capacity)));
        const names = take.map((m) => first(m.name));
        const longest = take[0].academyJoinedOn ? daysSince(take[0].academyJoinedOn, today) : null;
        const c = first(coach.coachName);
        out.push({
          key: `pair:${take.map((m) => m.athleteId).sort().join(',')}`,
          kind: 'pair',
          title: take.length === 2 ? `לשבץ את ${names[0]} ו־${names[1]} אצל ${c}?` : `לשבץ את ${names[0]} אצל ${c}?`,
          sub: [
            longest !== null && longest > 0 ? `בלי מאמן ${longest === 1 ? 'יום' : `${longest} ימים`}` : 'בלי מאמן',
            `${c} פנוי`,
          ].join(' · '),
          primary: take.length === 2 ? 'לשבץ שניהם' : 'לשבץ',
          people: take.map((m) => ({ id: m.athleteId, name: m.name })),
          coachId: coach.coachId,
          coachName: coach.coachName || '',
        });
      }
    }
  }

  // (b) The quietest trainee, a message.
  const quiet = approved
    .filter((m) => m.daysSinceActivity !== null && m.daysSinceActivity >= QUIET_DAYS)
    .sort((a, b) => (b.daysSinceActivity ?? 0) - (a.daysSinceActivity ?? 0) || a.name.localeCompare(b.name));
  for (const m of quiet.slice(0, 3)) {
    out.push({
      key: `write:${m.athleteId}`,
      kind: 'write',
      title: `לכתוב ל־${first(m.name)}?`,
      sub: `לא רץ ${m.daysSinceActivity} ימים`,
      primary: 'לכתוב',
      people: [{ id: m.athleteId, name: m.name }],
    });
  }

  // (c) The week didn't reach some watches.
  const people = [...new Map(dispatch.map((d) => [d.athleteId, d.name])).entries()].map(([id, name]) => ({ id, name }));
  if (people.length) {
    out.push({
      key: `resend:${people.map((p) => p.id).sort().join(',')}`,
      kind: 'resend',
      title: people.length === 1 ? `האימון לא הגיע לשעון של ${first(people[0].name)}` : `${people.length} אימונים לא הגיעו לשעון`,
      sub: people.length === 1 ? 'אפשר לשלוח שוב מהשעונים' : people.slice(0, 3).map((p) => first(p.name)).join(', '),
      primary: 'לשלוח שוב',
      people,
    });
  }

  return out;
}

// ── Snooze and dismiss ──────────────────────────────────────────────────────

export type SuggestionStore = Record<string, { until?: number; dismissed?: boolean }>;

export const SUGGESTION_STORE_KEY = 'mc_academy_suggestions';

export function isHidden(store: SuggestionStore, key: string, nowMs: number): boolean {
  const e = store[key];
  return !!e && (!!e.dismissed || (typeof e.until === 'number' && e.until > nowMs));
}

/** The first suggestion not snoozed or dismissed. */
export function nextSuggestion(list: Suggestion[], store: SuggestionStore, nowMs: number): Suggestion | null {
  return list.find((s) => !isHidden(store, s.key, nowMs)) ?? null;
}

/** "Remind me tomorrow": hidden until 06:00 UTC (08:00/09:00 in Israel) of the next Israel day. */
export function snoozeUntilTomorrow(store: SuggestionStore, key: string, nowMs: number): SuggestionStore {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(nowMs));
  const next = new Date(`${today}T06:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { ...store, [key]: { until: next.getTime() } };
}

export function dismissSuggestion(store: SuggestionStore, key: string): SuggestionStore {
  return { ...store, [key]: { dismissed: true } };
}
