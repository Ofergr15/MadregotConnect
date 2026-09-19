/**
 * Joining a candidate to the athlete they became.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────
 *
 * The same human arrives twice, through two doors that do not know about each other:
 *
 *   1. Staff open a candidate row (`academy_candidates`) the moment somebody sends an
 *      Instagram DM. The name is whatever the coach typed — Hebrew, usually `אבי ברק`.
 *   2. The person registers themselves at `/academy-register`, which creates an `athletes`
 *      row with `is_academy: true`. That row's name is Latin, because the public form
 *      enforces it (`lib/names/latin.ts`).
 *
 * `academy_candidates.athlete_id` is the field that joins them, and until this module there
 * was nothing that filled it in. So the funnel lost the candidate at the exact moment they
 * succeeded: steps 5-9 (watch, test, analysis, band, first plan) are all facts about an
 * ATHLETE, and with no `athlete_id` none of them can ever be derived — they can only be
 * hand-stamped, forever, by somebody remembering to.
 *
 * ── WHY THE NAME IS NOT THE KEY ──────────────────────────────────────────────────────────
 *
 * The obvious matcher — compare the names — cannot work here, and quietly returns nothing
 * rather than failing loudly. `אבי ברק` and `Avi Barak` are the same person and share no
 * character. So the keys, in the order they are trusted:
 *
 *   - **email**, normalised. The only field both doors ask for in the same alphabet.
 *   - **phone**, normalised past the four ways an Israeli number gets written.
 *   - **name**, and ONLY when both sides happen to be Latin. Never an exact match, because
 *     a club of 25 has two people called David.
 *   - **recency**, which is not a match at all but is what a human actually uses: the
 *     athlete who registered two days after the characterization call is probably him.
 *
 * ── NOTHING HERE LINKS ANYTHING ──────────────────────────────────────────────────────────
 *
 * This module ranks and explains; the coach taps. There is no auto-link even on an exact
 * email match, because the cost of being wrong is not a wrong row — it is one stranger's
 * injuries and another person's private `fit` verdict attached to somebody else's account,
 * and a shared family address is enough to cause it.
 */

/** A Strava login with no real email gets a fabricated one. It is not an identity. */
export const SYNTHETIC_EMAIL_DOMAIN = 'strava.madregot.local';

/**
 * How close in time an athlete's registration has to be to the candidate's last event before
 * recency is worth mentioning. A guess, and a generous one: somebody characterised on a
 * Sunday may only get round to registering the following weekend.
 */
export const RECENT_REGISTRATION_DAYS = 21;

/** How many recency-only rows are worth showing before the list becomes a roster dump. */
export const MAX_RECENT_SUGGESTIONS = 5;

export type MatchReason = 'email' | 'phone' | 'name' | 'recent';

/**
 * `exact` — the same email or phone, which is as close to proof as this data gets.
 * `likely` — the same Latin name, or a registration through the academy door at the right time.
 * `weak`   — registered around the right time, and nothing else.
 */
export type MatchConfidence = 'exact' | 'likely' | 'weak';

export interface LinkableAthlete {
  id: string;
  name: string;
  email?: string | null;
  /**
   * Optional because the roster route does not currently return it. The match is written
   * anyway: a phone is the one key a candidate almost always has (a DM gives you a number
   * before it gives you an address), so this becomes the strongest match the day the column
   * is added to the select, and costs nothing until then.
   */
  phone?: string | null;
  isAcademy?: boolean | null;
  createdAt?: string | null;
}

export interface LinkableCandidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** The athlete already joined to this candidate, if there is one. */
  athleteId?: string | null;
}

export interface AthleteMatch {
  athlete: LinkableAthlete;
  reason: MatchReason;
  confidence: MatchConfidence;
  /** Why this row is on the list, in the words the sheet shows. */
  text: string;
  /**
   * This athlete is already joined to a DIFFERENT candidate. The partial unique index on
   * `athlete_id` means linking them would come back a 409, so the sheet shows the row
   * disabled with the reason rather than letting the coach discover it by being refused.
   *
   * Only ever true on an exact match, and that is the useful case: two candidate rows with
   * one email between them is a duplicate candidate, which is worth seeing.
   */
  taken: boolean;
}

/** Lowercased and trimmed, or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  return clean.includes('@') ? clean : null;
}

/** Whether an address was invented by the Strava login rather than given by a person. */
export function isSyntheticEmail(raw: unknown): boolean {
  const email = normalizeEmail(raw);
  return email !== null && email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

/**
 * An Israeli mobile number reduced to the one form all four spellings share.
 *
 * `050-123-4567`, `0501234567`, `+972-50-123-4567` and `972501234567` are one number, and
 * the funnel's phone is typed by hand during a call while the athlete's came off a
 * registration form. Everything but digits goes, then the international prefix becomes the
 * local leading zero.
 *
 * Returns null below nine digits, because a fragment matches far too much: `050` would
 * make every mobile in the club an exact match on the same person.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`;
  return digits.length >= 9 ? digits : null;
}

/** Latin letters only, lowercased, single-spaced — or null when the name is not Latin. */
function latinKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return null;
  // Every letter has to be Latin. A Hebrew name has no Latin key at all, which is the point:
  // it is how the name comparison declines to answer instead of answering wrongly.
  return /^[a-z][a-z' -]*$/.test(clean) ? clean : null;
}

/** Signed: positive when `b` is after `a`. */
function daysApart(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return (tb - ta) / 86_400_000;
}

/**
 * How far a registration sits from the call, in words.
 *
 * Says `מהשיחה` out loud rather than `לפני 6 ימים`, because the distance is measured from the
 * CALL and not from today, and "registered 6 days ago" is a different claim that happens to be
 * false. The direction is kept for the same reason: people register both before and after
 * being spoken to, and which one happened is what makes the row believable.
 *
 * Singular and plural both written out. `1 ימים` is the line that tells a reader a machine
 * wrote the screen.
 *
 * `viaAcademy` names the door. Which door somebody registered through is the strongest thing
 * this branch knows and the reason the row outranks a closer one, so the line says it instead
 * of leaving the order to be read as a sort bug.
 */
function registeredText(signedDays: number, viaAcademy: boolean): string {
  const what = viaAcademy ? 'נרשם לאקדמיה' : 'נרשם';
  const n = Math.round(Math.abs(signedDays));
  if (n === 0) return `${what} ביום השיחה`;
  const side = signedDays > 0 ? 'אחרי' : 'לפני';
  return n === 1 ? `${what} יום ${side} השיחה` : `${what} ${n} ימים ${side} השיחה`;
}

/**
 * The athletes worth offering for this candidate, best first.
 *
 * `takenBy` maps an athlete id to the candidate already holding it — read from the other
 * candidates on the board, so the sheet knows what the unique index would refuse.
 * `since` is the candidate's last event (or their creation), which is what recency is
 * measured against; without it recency is skipped rather than measured from the wrong end.
 */
export function suggestAthleteLinks(
  candidate: LinkableCandidate,
  athletes: readonly LinkableAthlete[],
  opts: { takenBy?: Readonly<Record<string, string>>; since?: string | null } = {},
): AthleteMatch[] {
  const takenBy = opts.takenBy ?? {};
  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const name = latinKey(candidate.name);

  const matches: AthleteMatch[] = [];
  const seen = new Set<string>();
  const recent: { match: AthleteMatch; days: number }[] = [];

  for (const athlete of athletes) {
    // The athlete already joined to THIS candidate is not a suggestion — they are the
    // current answer, and the sheet shows them somewhere else entirely.
    if (athlete.id === candidate.athleteId) continue;

    const takenByOther = takenBy[athlete.id] !== undefined && takenBy[athlete.id] !== candidate.id;
    const push = (reason: MatchReason, confidence: MatchConfidence, text: string) => {
      if (seen.has(athlete.id)) return;
      seen.add(athlete.id);
      matches.push({ athlete, reason, confidence, text, taken: takenByOther });
    };

    const athleteEmail = normalizeEmail(athlete.email);
    // A fabricated Strava address is not evidence of anything, and two of them can even
    // agree with each other. Excluded before the comparison, not after.
    if (email && athleteEmail === email && !isSyntheticEmail(athleteEmail)) {
      push('email', 'exact', 'אותה כתובת אימייל');
      continue;
    }

    if (phone && normalizePhone(athlete.phone) === phone) {
      push('phone', 'exact', 'אותו מספר טלפון');
      continue;
    }

    // Past this point the evidence is circumstantial, and an athlete already spoken for is
    // only noise: the coach cannot pick them, and a disabled row with a weak reason is a
    // question nobody can answer.
    if (takenByOther) continue;

    if (name && latinKey(athlete.name) === name) {
      push('name', 'likely', 'אותו שם');
      continue;
    }

    if (opts.since && athlete.createdAt) {
      const days = daysApart(opts.since, athlete.createdAt);
      if (days !== null && Math.abs(days) <= RECENT_REGISTRATION_DAYS) {
        recent.push({
          match: {
            athlete,
            reason: 'recent',
            // A registration through `/academy-register` at roughly the right time is not the
            // same claim as any registration at roughly the right time, and the difference has
            // to be VISIBLE: the sort already puts these first, so without a different badge
            // the coach sees two identical `אפשרי` rows with the further one on top, which
            // reads as a sort bug rather than as evidence. It is also honestly the stronger
            // key — in a club of 25 a shared Latin first-and-last name is `כנראה`, and
            // somebody who walked through the academy door that week is at least that.
            confidence: athlete.isAcademy ? 'likely' : 'weak',
            text: registeredText(days, Boolean(athlete.isAcademy)),
            taken: false,
          },
          days: Math.abs(days),
        });
      }
    }
  }

  // Newest first inside the recency tail, and academy-flagged athletes ahead of the rest:
  // somebody who registered through `/academy-register` is already holding up a hand.
  recent.sort((a, b) => {
    const flag = Number(Boolean(b.match.athlete.isAcademy)) - Number(Boolean(a.match.athlete.isAcademy));
    return flag !== 0 ? flag : a.days - b.days;
  });

  for (const { match } of recent.slice(0, MAX_RECENT_SUGGESTIONS)) {
    if (seen.has(match.athlete.id)) continue;
    seen.add(match.athlete.id);
    matches.push(match);
  }

  return matches;
}

/**
 * The roster filtered by what the coach typed, for the search under the suggestions.
 *
 * Name OR email, substring, case-insensitive — and NOT the Latin-key comparison used for
 * matching. Search is the coach looking for a row they can already see in their head, so
 * `dav` has to find David; matching is the machine claiming two rows are one person, and
 * those need different amounts of evidence.
 */
export function filterAthletes(athletes: readonly LinkableAthlete[], query: string): LinkableAthlete[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...athletes];
  return athletes.filter(a => {
    const email = normalizeEmail(a.email);
    return a.name.toLowerCase().includes(q) || (email !== null && !isSyntheticEmail(email) && email.includes(q));
  });
}

/**
 * Whether linking this athlete also has to flip `is_academy`.
 *
 * It usually does not: `/api/academy/register` sets the flag as it creates the row, so
 * anybody who came through the public academy door already has it. The case this catches is
 * the person who was already a club member and joined the academy afterwards — their row
 * predates the academy entirely, and without the flag they are invisible to every academy
 * screen (tests, bands, threads, dispatch) with no screen anywhere able to fix it.
 */
export function needsAcademyFlag(athlete: Pick<LinkableAthlete, 'isAcademy'>): boolean {
  return !athlete.isAcademy;
}
