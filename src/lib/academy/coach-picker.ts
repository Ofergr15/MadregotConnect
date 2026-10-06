// "שיבוץ מאמנים" — the one way a trainee's coaches are chosen, wherever it is
// opened from (the member card, the quick action, a suggestion's ⋯, adding a club
// member, the funnel's accept, the coaches board). Pure: the picker
// (components/academy/CoachesPicker.tsx) draws it, and the tests read it.
//
// Since migration 135 a trainee has any number of coaches, all equal, so the
// picker is always a multi-select. For many trainees at once there are two modes:
//
//   'replace'  "להעביר"      everyone's coaches become exactly the ticked ones
//   'add'      "להוסיף מאמן" the ticked coaches join; the coaches they have stay
//
// Before 135 is pasted only one coach can be stored, so the picker turns single
// (a tick replaces the previous one) and says so instead of failing on save.

import { joinHebrewList } from './members';

export type AssignMode = 'replace' | 'add';

/** The one wording every door uses. */
export const ASSIGN_COACHES_LABEL = 'שיבוץ מאמנים';

/** Shown when migration 135 is not in yet, in place of a save that would fail. */
export const ONE_COACH_UNTIL_UPDATE = 'כרגע אפשר מאמן אחד למתאמן. כמה מאמנים למתאמן יתאפשרו אחרי עדכון מסד הנתונים.';

/** Tick or untick a coach. `multi: false` (before 135) keeps at most one. */
export function toggleCoach(set: string[], id: string, multi: boolean): string[] {
  if (set.includes(id)) return set.filter((c) => c !== id);
  return multi ? [...set, id] : [id];
}

/** A trainee's coaches after the save. */
export function coachesAfter(before: string[], picked: string[], mode: AssignMode): string[] {
  if (mode === 'replace') return [...picked];
  return [...before, ...picked.filter((c) => !before.includes(c))];
}

/**
 * How many trainees a coach will hold once this is saved, so the load bar answers
 * "can he take them?". `sets` are the current coaches of every trainee being
 * assigned; a shared trainee takes a place on each of their coaches.
 */
export function loadAfter(coachId: string, trainees: number, sets: string[][], picked: string[], mode: AssignMode): number {
  let n = trainees;
  for (const before of sets) {
    const was = before.includes(coachId);
    const now = coachesAfter(before, picked, mode).includes(coachId);
    n += Number(now) - Number(was);
  }
  return Math.max(0, n);
}

/** Same coaches, same first one — nothing to save. */
export function sameCoachSet(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((c) => after.includes(c)) && before[0] === after[0];
}

/**
 * The POST /api/academy/members/bulk body for a save. One trainee and many take
 * the same path: 'coach' replaces with the whole set, 'addCoach' adds the ticked
 * coaches and keeps the rest. `[]` with 'replace' takes everyone's coaches off.
 */
export function assignBody(athleteIds: string[], picked: string[], mode: AssignMode, notify: boolean): {
  athleteIds: string[]; action: 'coach' | 'addCoach'; coachIds: string[]; notify: boolean;
} {
  return { athleteIds, action: mode === 'add' ? 'addCoach' : 'coach', coachIds: [...picked], notify };
}

/** "לשמור · 2 מאמנים" — the save button for one trainee. */
export function saveCoachesLabel(n: number): string {
  return n === 0 ? 'לשמור · בלי מאמן' : n === 1 ? 'לשמור · מאמן אחד' : `לשמור · ${n} מאמנים`;
}

const first = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';

/**
 * The save button for many trainees, in the mode's own verb. `fresh`: none of them
 * has a coach yet, so there is nothing to move — they are placed ("לשבץ").
 */
export function bulkCta(mode: AssignMode, count: number, pickedNames: string[], none: boolean, fresh = false): string {
  const who = count === 1 ? 'מתאמן אחד' : `${count} מתאמנים`;
  const names = joinHebrewList(pickedNames.map(first).filter(Boolean));
  if (mode === 'replace' && none) return `${who} בלי מאמן`;
  if (!names) return 'בוחרים מאמן';
  if (fresh) return `לשבץ ${who} אצל ${names}`;
  return mode === 'add' ? `להוסיף את ${names} ל־${who}` : `להעביר ${who} ל־${names}`;
}

/**
 * "Dana, Guy ו־Avi" for a Hebrew line made of Latin names. Each name is isolated
 * (FSI…PDI) and the line starts with an RLM, otherwise the bidi algorithm glues
 * "Dana, Guy" into one left-to-right run and the list reads in the wrong order
 * ("Guy ו־ Dana, Shir"). The string form of a <bdi> per name.
 */
export function bidiNames(names: string[]): string {
  const list = names.filter(Boolean);
  return list.length ? `\u200F${joinHebrewList(list.map((n) => `\u2068${n}\u2069`))}` : '';
}
