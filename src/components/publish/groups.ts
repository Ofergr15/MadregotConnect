/**
 * The club's three groups, as every publish screen draws them.
 *
 * Shared rather than re-declared per file because ❶ being ink, ❷ the league blue
 * and ❸ the league orange is the only thing that tells the coach which column is
 * which on a screen that has three of everything.
 */

export const GROUPS = [1, 2, 3] as const;

/** ❶ ❷ ❸ — the club's own notation for its groups, on every screen it has. */
export const GROUP_MARKS = ['❶', '❷', '❸'];

export const GROUP_TEXT = ['text-ink-900', 'text-band-2-ink', 'text-band-3-ink'];
export const GROUP_CELL = ['bg-ink-900/[0.045]', 'bg-band-2/10', 'bg-band-3/10'];
export const GROUP_DOT = ['bg-ink-900', 'bg-band-2', 'bg-band-3'];

export function roundKm(meters: number): number {
  return Math.round(meters / 100) / 10;
}
