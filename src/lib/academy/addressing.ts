/**
 * "פנייה": how the app speaks to a person. Stored as `athletes.gender` (migration 057,
 * 'male' | 'female' | null); null means nobody has said, and every gendered sentence then
 * keeps the wording it had before the field existed (the ICU `other` branch).
 */

export type Addressing = 'male' | 'female';

export const ADDRESSING_OPTIONS: ReadonlyArray<{ value: Addressing | null; label: string }> = [
  { value: 'male', label: 'זכר' },
  { value: 'female', label: 'נקבה' },
  { value: null, label: 'לא ידוע' },
];

/** A stored value as the field reads it: anything but the two known answers is "not known". */
export function addressingOf(raw: unknown): Addressing | null {
  return raw === 'male' || raw === 'female' ? raw : null;
}

/** The PUT body: `{ athleteId, gender }`, where an empty gender clears the answer. */
export function parseAddressing(body: unknown):
  | { ok: true; athleteId: string; gender: Addressing | null }
  | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const athleteId = typeof b.athleteId === 'string' ? b.athleteId.trim() : '';
  if (!athleteId) return { ok: false, error: 'athleteId is required' };
  if (!('gender' in b)) return { ok: false, error: 'gender is required (null clears it)' };
  const g = b.gender;
  if (g === null || g === '') return { ok: true, athleteId, gender: null };
  if (g === 'male' || g === 'female') return { ok: true, athleteId, gender: g };
  return { ok: false, error: "gender must be 'male', 'female' or null" };
}
