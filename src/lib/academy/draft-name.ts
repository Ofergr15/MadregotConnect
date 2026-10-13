import { structureName, type BookStep } from './book-steps';

/**
 * A draft's name after its structure changed (launch N24). Changing the reps 8 → 9 kept
 * "8 × 800 מ׳" in the send, the book, the plan and on the watch. A name that was DERIVED
 * from the structure (it equals what the old structure is called) follows the new one; a
 * name somebody wrote ("טמפו של יום שלישי") is theirs and stays.
 */
export function renamedForStructure(
  name: string,
  prev: BookStep[] | null | undefined,
  next: BookStep[],
  original?: BookStep[] | null,
): string {
  const derived = [prev, original].filter((m): m is BookStep[] => !!m?.length).map((m) => structureName(m));
  if (!derived.includes(name.trim())) return name;
  return structureName(next) || name;
}
