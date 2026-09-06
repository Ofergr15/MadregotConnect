/**
 * הגרעין — the club's core squad. One module, because this fact is read in five
 * places (the perks gate, search, the profile badge, the athletes list, the
 * management screen) and a second copy of the rule is how the perks tier and the
 * badge end up disagreeing about who is in.
 *
 * ── WHY A FLAG AND NOT A ROLE ────────────────────────────────────────────────
 * גרעין shipped as `athletes.role = 'core_runner'` (migration 008), which put two
 * different questions in one column:
 *
 *   role            → what may you DO in the app   (admin / coach / runner / …)
 *   is_core_runner  → are you IN the גרעין          (a membership tier)
 *
 * Those are orthogonal in the real club — a coach can be a core runner — and a
 * single column cannot hold both, so marking a coach as core meant demoting them
 * out of staff. Migration 091 adds the flag next to `role`, exactly as 084 added
 * is_super_user/is_approver next to it, and this helper reads BOTH so the old role
 * value keeps working: nobody has to be re-tagged and the migration only ever
 * grants, never revokes.
 *
 * `role === 'core_runner'` stays valid input, but it is legacy. New members get
 * the flag; leave their role alone.
 */

/** The mark, chosen by Ofer: גרעין, literally. Never inline the character — it
 *  appears next to names all over the app and has to be changeable in one edit. */
export const CORE_RUNNER_MARK = '🌰';

/** Hebrew label, singular and plural. The app's UI language is Hebrew. */
export const CORE_RUNNER_LABEL = 'רץ גרעין';
export const CORE_RUNNER_LABEL_PLURAL = 'רצי הגרעין';

/** The legacy role value that used to be the only way to say this. */
export const CORE_RUNNER_ROLE = 'core_runner';

/**
 * Anything that might carry the fact — a session user, an athlete row (snake or
 * camel), an API DTO. Deliberately wide: every caller has a slightly different
 * shape and none of them should have to normalise before asking.
 */
export interface CoreRunnerLike {
  isCoreRunner?: boolean | null;
  is_core_runner?: boolean | null;
  role?: string | null;
}

/**
 * Is this person in the גרעין?
 *
 * True on EITHER source. The flag is authoritative going forward; the role value
 * is honoured so the answer is right before migration 091 is pasted into the SQL
 * editor (migrations here are applied by hand) and for any row still carrying it.
 */
export function isCoreRunner(subject: CoreRunnerLike | null | undefined): boolean {
  if (!subject) return false;
  if (subject.isCoreRunner === true || subject.is_core_runner === true) return true;
  return subject.role === CORE_RUNNER_ROLE;
}

/**
 * Is the גרעין recorded on this row the LEGACY way — the role value, without the
 * flag? Those rows are the ones the management screen offers to convert: they
 * cannot also be a coach until they are.
 */
export function isLegacyCoreRunner(subject: CoreRunnerLike | null | undefined): boolean {
  if (!subject) return false;
  const flagged = subject.isCoreRunner === true || subject.is_core_runner === true;
  return !flagged && subject.role === CORE_RUNNER_ROLE;
}
