/**
 * Which edges of the quick-reply row (an LTR scroller holding RTL chips laid out
 * reversed, so chip 1 is at the RIGHT end) hide more chips.
 *  - `end`: chips hidden on the LEFT — the ones still to read in RTL.
 *  - `start`: chips hidden on the RIGHT — the reader has scrolled past the first.
 * One pixel of slack: WebKit reports fractional scroll positions.
 */
export function chipFades(scrollLeft: number, scrollWidth: number, clientWidth: number): { start: boolean; end: boolean } {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (max <= 1) return { start: false, end: false };
  return { end: scrollLeft > 1, start: scrollLeft < max - 1 };
}
