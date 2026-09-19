/**
 * The book's vocabulary — the Hebrew for the things `lib/academy/library.ts` names in English.
 *
 * Its own file because both the list and the editor need it, and the two must agree: a coach
 * picks `קצב סף` in the form and then has to recognise the same two words on the row they just
 * wrote. When the list held these and the editor imported them from it, the editor's import
 * made a cycle the moment the list needed the editor back.
 */

import type { LibraryKind } from '@/lib/academy/library';

export const KIND_LABEL: Record<LibraryKind, string> = {
  intervals: 'אינטרוולים',
  tempo: 'טמפו',
  long: 'ארוך',
  easy: 'קל',
  hills: 'גבעות',
  test: 'טסט',
};

/**
 * The academy's own words for each effort.
 *
 * `threshold` is `קצב סף` — the phrase the mockup writes into the list row itself, and the one
 * Ofer uses out loud. An effort with no name of its own falls through to its percentage, which
 * is the mockup's second row (`102% מהסף`) and the general case: the book can hold any
 * intensity, not only the six the editor offers.
 */
export const ZONE_LABEL: Record<string, string> = {
  easy: 'קל',
  marathon_pace: 'קצב מרתון',
  tempo: 'טמפו',
  threshold: 'קצב סף',
  interval: 'אינטרוולים',
  sprint: 'ספרינט',
};
