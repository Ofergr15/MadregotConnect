/**
 * A clock typed on a phone's number pad: the iPhone's numeric keypad has no ":", so the
 * digits are laid out from the right — seconds, minutes, then hours — as they are typed.
 * "23400" → "2:34:00", "3655" → "36:55", "730" → "7:30". A typed ":" is ignored (the
 * colons are always ours), so pasting "2:34:00" lands the same way.
 */
export function typeClock(raw: string, maxDigits = 6): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d{3})/, '').slice(0, maxDigits);
  if (digits.length <= 2) return digits;
  const ss = digits.slice(-2);
  const rest = digits.slice(0, -2);
  if (rest.length <= 2) return `${rest}:${ss}`;
  return `${rest.slice(0, -2)}:${rest.slice(-2)}:${ss}`;
}
