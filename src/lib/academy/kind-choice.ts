import { isLibraryKind, type LibraryKind } from './library';

/**
 * A book entry's type is the coach's word, never the app's guess (Ofer, 2026-10-20: "only that
 * way it gets labelled truthfully"). Every door that writes an entry with a type — save as new,
 * the send screen's "לשמור בספר", the manager's editor, the import review — starts with NO type
 * picked and will not save until one is. What the app infers is shown as a hint only
 * ("נראה כמו: מהיר"), one tap from being chosen, never pre-chosen.
 */
export type KindChoice = LibraryKind | null;

/** May this be written: a real type, chosen. */
export function kindChosen(kind: unknown): kind is LibraryKind {
  return isLibraryKind(kind);
}

/** The hint line's type, or null when there is nothing worth suggesting. */
export function kindHint(inferred: unknown, chosen: KindChoice): LibraryKind | null {
  return isLibraryKind(inferred) && inferred !== chosen ? inferred : null;
}

/** The import review: every ticked row needs a chosen type; which are still missing. */
export function missingKinds(picked: Iterable<string>, kinds: Record<string, KindChoice | undefined>): string[] {
  return [...picked].filter(key => !kindChosen(kinds[key]));
}

export const KIND_REQUIRED_TEXT = 'צריך לבחור סוג';
