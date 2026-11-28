/**
 * The one "m:ss" pace formatter (seconds per km → "4:05").
 *
 * Rounds to whole seconds BEFORE splitting into minutes/seconds, so 239.6 s
 * reads "4:00" — the old per-file copies split first and printed "3:60".
 * Zero stays "0:00" (several callers guard it themselves); NaN, ±Infinity and
 * negatives are not paces and come back as '—' instead of "NaN:NaN" / "-1:-28".
 * Output is ASCII digits + ':' only; wrap with `<bdi dir="ltr">` (see bidi.ts)
 * when embedding next to Hebrew text with spaces/slashes.
 */
export const NO_PACE = '—';

export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm < 0) return NO_PACE;
  const whole = Math.round(secPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The one strict "m:ss" pace parser ("4:05" → 245). Seconds must be two digits;
 * anything else (blank, "4:5", "4.05", "245") is null. Callers with a looser
 * input language (the step-tree / day-session editors accept "405" and "4.05";
 * the AI parser accepts a pace inside free text) keep their own rules on purpose
 * and are not routed through here.
 */
export function parsePace(text: string): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
