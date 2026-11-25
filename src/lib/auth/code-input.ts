// Pure helpers for the 6-box code entry (components/auth/EmailCodeLogin).

export const CODE_LENGTH = 6;

/**
 * Put whatever arrived in box `at` — one typed digit, a pasted "123 456", or an
 * autofilled code — into the boxes from `at` onwards. Non-digits are dropped.
 * An empty input clears that box. `focus` is the box to move to next.
 */
export function placeDigits(current: string[], at: number, raw: string): { next: string[]; focus: number } {
  const next = [...current];
  const incoming = raw.replace(/\D/g, '');
  if (!incoming) {
    next[at] = '';
    return { next, focus: at };
  }
  // A single typed key into a box that already held a digit: the new key is the last char.
  const chars = incoming.length === 2 && current[at]
    ? [incoming.replace(current[at], '')]
    : incoming.split('');
  // A full code always fills from the first box, wherever it was pasted.
  const start = chars.length >= CODE_LENGTH ? 0 : at;
  let i = start;
  for (const c of chars) {
    if (i >= CODE_LENGTH) break;
    next[i++] = c;
  }
  return { next, focus: i };
}

/** The code once every box holds a digit, else null. */
export function codeDigits(digits: string[]): string | null {
  const code = digits.join('');
  return code.length === CODE_LENGTH && /^\d+$/.test(code) ? code : null;
}
