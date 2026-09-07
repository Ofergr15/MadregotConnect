/**
 * Which club member a Strava login belongs to.
 *
 * Strava's token response carries no email address — only a numeric athlete id
 * and a display name — so `strava_<id>@strava.madregot.local` is a synthetic
 * address the app invents purely to have something to hang a Supabase auth user
 * on. Nothing else in the club roster uses it: real members are rows keyed on
 * their real email.
 *
 * That mismatch is what produced four duplicate athlete rows in production
 * (Ofer, Tal, Shahar, Sahar — three of them admins). Two separate defects fed
 * it, and this module exists so both are fixed in one place instead of three:
 *
 *   1. The OAuth callback recognised a returning athlete ONLY by
 *      `strava_athlete_id`, a column that is written *by* a Strava login. On a
 *      member's first Strava login it is therefore always NULL, no row matches,
 *      and the callback inserts a second row for somebody who is already in the
 *      club — with no group, `role: 'runner'`, and none of their history.
 *   2. /api/auth/resolve-role then decided who you are by looking `athletes` up
 *      on the session's email, i.e. on the synthetic address. So even when the
 *      callback DID find the right row, the resolve step threw that away and
 *      resolved to whichever row happened to own the synthetic address.
 *
 * The fix is to treat the Strava athlete id as the identity and the email as one
 * of several ways to reach it: `stravaIdFromAuthEmail` recovers the id from the
 * synthetic address (so it survives a lost session, a stale user_metadata blob,
 * or a device cookie that only stored an email), and `pickAthleteRow` chooses
 * between candidate rows deterministically rather than taking "the oldest" or
 * "the first" — both of which picked the duplicate about half the time.
 */

/** Emails minted by stravaAuthEmail() in @/lib/strava/client. */
const STRAVA_AUTH_EMAIL = /^strava_(\d+)@strava\.madregot\.local$/i;

/**
 * The Strava athlete id encoded in a synthetic auth email, or null for a real
 * address. Lets any route that holds only an email — resolve-role, the device
 * cookie behind silent-session — recover the identity without a round trip.
 */
export function stravaIdFromAuthEmail(email?: string | null): number | null {
  const match = STRAVA_AUTH_EMAIL.exec((email || '').trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** True for an address the app invented, false for a member's own email. */
export function isSyntheticAuthEmail(email?: string | null): boolean {
  return stravaIdFromAuthEmail(email) !== null;
}

/**
 * Names as written by two different sources have to compare equal: Strava sends
 * "Tal Borenstein" from the profile, the roster row was typed by the coach. Case,
 * surrounding and repeated whitespace, and Unicode composition (Hebrew vowel
 * marks arrive both composed and decomposed) are all noise here.
 */
export function normalizeAthleteName(name?: string | null): string {
  return (name || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MATCHING A STRAVA NAME TO A ROSTER NAME WRITTEN IN ANOTHER SCRIPT
 *
 * `normalizeAthleteName` above bridges case, spacing and composition, and for a
 * roster typed in the same alphabet Strava returns it is enough. For this club it
 * mostly isn't: members are on the roster as "אסף אלקסלסי" and Strava sends
 * "Asaf Elkeslassy", so the exact match can never fire and the callback inserts a
 * duplicate — guaranteed, not unlucky. Six of the club's rows are Hebrew names.
 *
 * Hebrew is a consonantal script, which is exactly what makes this tractable
 * without a transliteration table per name: reduce BOTH sides to their consonant
 * skeleton and they converge.
 *
 *   אסף אלקסלסי    → א(-) ס(s) ף(f→p)  ·  א(-) ל(l) ק(k) ס(s) ל(l) ס(s) י(-)
 *                  → "sp lksls"
 *   Asaf Elkeslassy → A(-) s a(-) f(→p) ·  E(-) l k e(-) s l a(-) ss(→s) y(-)
 *                  → "sp lksls"
 *
 * The reductions, and why each one is needed rather than tidy:
 *   · vowels a e i o u y w and the letter h are dropped. Hebrew doesn't write
 *     vowels, so any vowel a transliteration chose is invention; ה/ח are h-ish
 *     sounds that transliterations drop about half the time.
 *   · א and ע are glottal — silent as far as a Latin spelling is concerned.
 *   · sounds one script writes with one letter and the other with several are
 *     folded to one symbol: b/v (ב, ו), p/f (פ), k/c/q (כ, ק), s/sh (ס, ש),
 *     t (ט, ת), ts/tz (צ). Getting these wrong is the difference between "Asaf"
 *     and "אסף" matching at all.
 *   · doubled letters collapse: "Elkeslassy" has ss where Hebrew has one ס.
 *
 * WORD ORDER IS IGNORED (the skeletons are compared as a sorted multiset)
 * because "Firstname Lastname" and the reverse both appear in practice.
 *
 * The result is deliberately lossy, so it is used under two hard conditions: the
 * match must be UNIQUE in the roster, and — for anything the app acts on by
 * itself — EXACT. A near match is offered to a human instead (see
 * `suggestAthleteByName`), because the cost of a wrong match here is not a
 * duplicate row: it is handing one member another member's account, history and
 * possibly their staff role.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Hebrew letter → the Latin consonant symbol both scripts get folded onto. */
const HEBREW_CONSONANTS: Record<string, string> = {
  א: '', ע: '',                     // glottal — silent in any Latin spelling
  ב: 'b', ו: 'b',                   // b/v/w are one symbol
  ג: 'g', ד: 'd',
  ה: '', ח: '',                     // h-ish; dropped on both sides
  ז: 'z', ט: 't',
  י: '',                            // yod reads as a vowel in transliteration
  כ: 'k', ך: 'k', ק: 'k',
  ל: 'l',
  מ: 'm', ם: 'm',
  נ: 'n', ן: 'n',
  ס: 's', ש: 's',
  פ: 'p', ף: 'p',                   // p and f are one symbol
  צ: 'c', ץ: 'c',                   // ts/tz
  ר: 'r', ת: 't',
};

/** Latin letters folded the same way, so the two skeletons are comparable. */
const LATIN_FOLD: Record<string, string> = {
  a: '', e: '', i: '', o: '', u: '', y: '', h: '', w: 'b',
  v: 'b', b: 'b',
  f: 'p', p: 'p',
  c: 'k', k: 'k', q: 'k',
  s: 's', z: 'z',
  t: 't', d: 'd', g: 'g', j: 'g',
  l: 'l', m: 'm', n: 'n', r: 'r', x: 'ks',
};

/**
 * One word reduced to its consonant skeleton, or '' if nothing survives.
 *
 * `vowelV` decides the one genuinely ambiguous sound. ו is a consonant in לוי
 * (Levi) and a vowel in רועי (Ro'ey), and Latin v is ב about as often as it is ו —
 * so no single reading is right. Both are produced and either may match; see
 * athleteNameKeys.
 */
function wordSkeleton(word: string, vowelV: boolean): string {
  let out = '';
  // 'ts'/'tz' is one sound (צ) — folded before the letters are read one by one.
  const source = word
    .replace(/t[sz]/g, 'c')
    .replace(/sh/g, 's')
    .replace(/ch|kh/g, '')
    // Matres lectionis: א ה ו י at the END of a word spell a vowel, not a
    // consonant — "פרדו" is Pardo, whose Latin spelling ends in a plain o. Left in,
    // ו mapped to b, and Pardo would never match פרדו. In the MIDDLE of a word ו is
    // usually a real v (לוי → Levi), so it is only stripped here, at the end.
    .replace(/[אהוי]+$/u, '');
  for (const ch of source) {
    if (vowelV && (ch === 'ו' || ch === 'v' || ch === 'w')) continue;
    const mapped = ch in HEBREW_CONSONANTS ? HEBREW_CONSONANTS[ch] : LATIN_FOLD[ch];
    // An unknown character (a digit, an emoji, a script we don't handle) is
    // dropped rather than passed through: passing it through would make two names
    // that differ only in punctuation fail to match.
    if (mapped) out += mapped;
  }
  // "ss" → "s". Applied after mapping so "ck" (→ kk) collapses too.
  return out.replace(/(.)\1+/g, '$1');
}

/**
 * The script-independent key for a full name: each word's consonant skeleton,
 * sorted, space-joined. '' when the name carries too little signal to match on
 * (see the length floor — a two-consonant key like "sr" would collide happily).
 */
export function athleteNameKey(name?: string | null): string {
  return buildKey(name, false);
}

function buildKey(name: string | null | undefined, vowelV: boolean): string {
  const key = [...nameWords(name, vowelV)].sort().join(' ');
  // At least four consonants across the whole name. Below that the skeleton is
  // not evidence of anything — "Dan Levi" and "Din Lavi" are the same key, and so
  // are plenty of unrelated pairs. '' means "cannot be matched on a name at all",
  // which is a safe answer: that person reaches the approval queue for a human to
  // place, rather than being guessed at.
  return long(key) ? key : '';
}

/**
 * Every reading of the name worth comparing — normally one, two when the name
 * contains a ו / v / w. Two names match when any reading of one equals any
 * reading of the other, which is what lets a Hebrew roster row meet a Latin
 * Strava name without the app having to decide which sound was meant.
 */
export function athleteNameKeys(name?: string | null): string[] {
  const keys: string[] = [];
  for (const vowelV of [false, true]) {
    const words = nameWords(name, vowelV);
    const sorted = [...words].sort().join(' ');
    if (long(sorted)) keys.push(sorted);
    // A second FORM, not a second reading: the same name with the words glued
    // together. It is what bridges a surname one source hyphenates and the other
    // does not — "עידו בר-און" against "Ido Baron", whose word skeletons are
    // {d, br, n} and {d, brn} and will never compare equal as multisets.
    //
    // Word ORDER has to be preserved for a glued form to mean anything, so both
    // orders are produced rather than sorting: "Firstname Lastname" and the
    // reverse both occur. The '~' prefix keeps the two forms in separate
    // namespaces — a glued key must never accidentally equal another name's
    // multiset key.
    if (words.length > 1) {
      const glued = words.join('');
      if (long(glued)) {
        keys.push(`~${glued}`);
        keys.push(`~${[...words].reverse().join('')}`);
      }
    }
  }
  return [...new Set(keys)];
}

/** Each word of the name as a skeleton, in the order written. */
function nameWords(name: string | null | undefined, vowelV: boolean): string[] {
  return (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0591-\u05c7]/g, '')
    .toLowerCase()
    .split(/[\s.,'\u2019\-_]+/)
    .map(word => wordSkeleton(word, vowelV))
    .filter(Boolean);
}

/** The four-consonant floor, applied to every key form. */
function long(key: string): boolean {
  return key.replace(/ /g, '').length >= 4;
}

/** True when two names share any reading. An unkeyable name matches nothing. */
function nameKeysMatch(a?: string | null, b?: string | null): boolean {
  const left = athleteNameKeys(a);
  if (!left.length) return false;
  const right = new Set(athleteNameKeys(b));
  return left.some(k => right.has(k));
}

/** Single-edit distance, used only to SUGGEST a match to a human. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return true;
}

export type IdentityRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  created_at?: string | null;
  strava_athlete_id?: number | null;
  strava_auth?: unknown;
  garmin_auth?: unknown;
};

// Mirrors STAFF_ROLES in @/lib/impersonation, which can't be imported here —
// it's a 'use client' module. Only used as a tie-breaker, so drifting by a role
// costs a preference, not a wrong identity.
const STAFF = new Set(['admin', 'coach', 'academy_coach']);

/**
 * Ranked highest-first, compared field by field. Every criterion is a fact about
 * the row rather than an accident of insertion order, which is the point: the
 * code this replaces sorted by `created_at` and took one end or the other, and
 * "oldest" is only the real row until the day someone's duplicate predates their
 * roster entry.
 */
function rank(row: IdentityRow, stravaId?: number | null): number[] {
  const isStravaMatch = !!stravaId && Number(row.strava_athlete_id) === Number(stravaId);
  return [
    // The Strava athlete id is the identity. A row carrying it IS this person.
    isStravaMatch ? 1 : 0,
    // A row with connected credentials is the one their activities flow into.
    (row.strava_auth ? 2 : 0) + (row.garmin_auth ? 1 : 0),
    // A member's own address over an address the app invented for itself: the
    // synthetic row is by construction the newer, emptier one.
    isSyntheticAuthEmail(row.email) ? 0 : 1,
    // Never sign a coach in as a runner. Their duplicate always says 'runner',
    // so this is the difference between staff tools and no staff tools.
    STAFF.has(row.role || '') ? 1 : 0,
    row.status === 'active' ? 1 : 0,
    // Last resort only: the club row predates the duplicate it caused.
    -new Date(row.created_at || 0).getTime(),
  ];
}

/**
 * The athlete row a login belongs to, out of every candidate that matched on
 * Strava id, email, or name. Returns null for an empty set — a genuinely new
 * person, who the caller may then create.
 */
export function pickAthleteRow<T extends IdentityRow>(
  rows: T[],
  stravaId?: number | null,
): T | null {
  let best: T | null = null;
  let bestRank: number[] = [];
  for (const row of rows) {
    const r = rank(row, stravaId);
    if (!best || compare(r, bestRank) > 0) {
      best = row;
      bestRank = r;
    }
  }
  return best;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * The one active roster row whose name matches, or null if none or more than one
 * does. Deliberately strict — an exact normalised full name and a UNIQUE match —
 * because this is the bridge used when a member logs in with Strava for the
 * first time and nothing else links their Strava account to the club. Matching
 * loosely (first name, or a prefix) would eventually hand one member's account,
 * history and staff role to another, which is worse than the duplicate row it
 * would be trying to avoid.
 */
export function matchAthleteByName<T extends IdentityRow>(rows: T[], name?: string | null): T | null {
  const target = normalizeAthleteName(name);
  if (!target) return null;
  const matches = rows.filter(
    r => r.status === 'active' && normalizeAthleteName(r.name) === target,
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * A row is a candidate to be somebody's REAL account if it is keyed on a real
 * email address. The synthetic-address rows are the ones this whole module exists
 * to fold away, so they are never a merge target — otherwise two Strava logins
 * for the same person could merge the older shell into the newer one and lose the
 * roster row entirely.
 *
 * `status` is deliberately NOT filtered. matchAthleteByName above only considers
 * `active` rows, and that is precisely how a just-approved member — still
 * `invited` until they open a link that the club's mail cannot currently deliver —
 * fell through every match and got a duplicate.
 */
function mergeTargets<T extends IdentityRow>(rows: T[]): T[] {
  return rows.filter(r => !isSyntheticAuthEmail(r.email));
}

/**
 * The one roster row whose name matches ACROSS SCRIPTS, or null.
 *
 * This is the bridge for "joined by email months ago, signs in with Strava
 * today": their row carries no Strava id, their real address is not the synthetic
 * one, and their name is written in the other alphabet. Requires an exact
 * skeleton match (see athleteNameKey) that is UNIQUE among rows keyed on a real
 * address — two members whose names reduce to the same skeleton produce no match
 * at all rather than a guess.
 */
export function matchAthleteByNameKey<T extends IdentityRow>(
  rows: T[],
  name?: string | null,
): T | null {
  if (!athleteNameKeys(name).length) return null;
  const matches = mergeTargets(rows).filter(r => nameKeysMatch(name, r.name));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * A NEAR match, for a human to confirm — never for the app to act on.
 *
 * Transliteration is not a function: "אלקסלסי" is spelled Elkeslassy, Elkessalsi
 * and Alkeslasi by three different people, and a single edit in the skeleton is
 * the difference. That is enough to put a name in front of an approver as "this
 * looks like…", and nowhere near enough to move an account onto it: an exact
 * match is required for anything automatic. Returns null when the name matches
 * exactly (the caller already has that answer) or when more than one row is
 * close.
 */
export function suggestAthleteByName<T extends IdentityRow>(
  rows: T[],
  name?: string | null,
): T | null {
  const targets = athleteNameKeys(name).map(k => k.replace(/ /g, ''));
  if (!targets.length) return null;
  const candidates = mergeTargets(rows).filter(r => {
    // An exact match is the caller's answer already, not a suggestion.
    if (nameKeysMatch(name, r.name)) return false;
    return athleteNameKeys(r.name).some(k =>
      targets.some(t => withinOneEdit(k.replace(/ /g, ''), t)),
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Every OTHER row that is the same person as `keep` and must be folded into it.
 *
 * Called on every Strava login, not only the first, because that is what makes
 * the repair automatic for the people who ALREADY have a duplicate: they sign in,
 * are recognised by their Strava id (which sits on the duplicate), and the roster
 * row is found by name — so the login itself is the moment both halves are in
 * hand. Waiting for a migration instead is how the club ended up with six.
 *
 * Only synthetic-address rows are ever returned. A row holding a real email is
 * somebody's account and is not deleted by a login handler under any
 * circumstances — if two such rows are really the same person, that is the
 * admin's merge to confirm.
 */
export function duplicatesToFold<T extends IdentityRow>(rows: T[], keep: T): T[] {
  return rows.filter(r => r.id !== keep.id && isSyntheticAuthEmail(r.email));
}

/**
 * The name STRAVA holds for this person, or null when it holds nothing usable.
 *
 * Strava owns the roster name from the moment a member connects it: the name on
 * the row is whatever a human typed at registration — Hebrew, sometimes
 * misspelled, sometimes a first name alone, sometimes placeholderNameFromEmail()
 * — and it is the only handle this app has when Strava sends a Latin display name
 * and no email address. Letting one side own the field is what stops the two
 * drifting apart, and stops the club seeing two spellings of one person.
 *
 * Returns null rather than a placeholder on purpose. The callback's own `name`
 * falls back to "Strava <id>" so that a brand-new row is never nameless, and
 * writing THAT over a name somebody chose would be a downgrade, not a sync.
 */
export function stravaDisplayNameOf(
  athlete: { firstname?: string | null; lastname?: string | null } | null | undefined,
): string | null {
  const joined = [athlete?.firstname, athlete?.lastname]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return joined || null;
}
