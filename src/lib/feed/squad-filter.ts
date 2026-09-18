/**
 * Narrowing the club feed to one squad.
 *
 * Reported as "add a filter on the feed by squad 1/2/3/academy" (373ebe89). The
 * club trains in three דבוקות plus the academy, and on a busy day the feed is one
 * undifferentiated stack — so "what did my squad do this morning" is a question
 * the screen could not answer.
 *
 * ── WHY THE ACADEMY IS NOT JUST A FOURTH GROUP ──────────────────────────────
 * `athletes.group_id` names one of the three pace squads. Academy membership is
 * the separate `is_academy` flag (an academy athlete also sits in a pace squad —
 * one does today), so the two cannot share a single column comparison, and an
 * academy filter that looked for a group id would silently match nobody. Same
 * shape as the additive academy rule in lib/nav-items.ts, and for the same
 * reason: it is a flag, not a role.
 *
 * The parse is separate from the lookup on purpose — validating a caller-supplied
 * value is the part worth testing, and it is the part that decides whether an
 * unexpected value degrades to the full feed or to an empty screen.
 */

export const ACADEMY_SQUAD = 'academy';

/**
 * The caller's own favourites list (ff8d932e). Rides on this axis rather than
 * getting its own param because it answers the same question the squad chips do
 * — WHOSE runs am I looking at — so "just the runs, from my favourites" stays
 * two independent taps, and the feed route keeps one id-resolution step instead
 * of two that could disagree.
 *
 * Unlike a group id or `academy`, this one is relative to the caller: the same
 * URL means a different set of athletes for every member, which is why the ids
 * are resolved from the verified session and never from the query string.
 */
export const FAVORITES_SQUAD = 'favorites';

export type SquadSelector =
  | { kind: 'group'; groupId: string }
  | { kind: 'academy' }
  | { kind: 'favorites' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?squad=` → what to filter by, or null for "no filter".
 *
 * Anything that is not `academy` or a well-formed uuid is null, i.e. the FULL
 * feed — the same call `types` makes for an unknown value, and for the same
 * reason: a stale bookmark or a typo should degrade to the feed everyone else
 * sees rather than to an empty screen nobody can explain. A syntactically valid
 * group id that matches no athlete is a different case and does come back empty:
 * there the answer "nobody in that squad has posted" is true.
 */
export function parseSquadParam(raw: string | null | undefined): SquadSelector | null {
  const value = (raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value === ACADEMY_SQUAD) return { kind: 'academy' };
  if (value === FAVORITES_SQUAD) return { kind: 'favorites' };
  return UUID_RE.test(value) ? { kind: 'group', groupId: value } : null;
}
