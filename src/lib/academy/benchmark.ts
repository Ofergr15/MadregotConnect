// Benchmark time helpers. Times are stored as seconds (with fractional part),
// e.g. "5:46.96" ↔ 346.96. Also supports bare seconds and H:MM:SS for longer tests.

/**
 * Parse a race/time-trial time string into seconds.
 * Accepts: "5:46.96", "5:49.0", "5:54", "6:03", "1:02:30" (h:mm:ss), "346.96".
 * Returns null if it can't be parsed.
 */
export function parseTime(input: string): number | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  const parts = s.split(':');
  // Every part except the last must be a whole number; the last may be decimal.
  const nums = parts.map((p, i) => (i === parts.length - 1 ? parseFloat(p) : parseInt(p, 10)));
  if (nums.some(n => Number.isNaN(n))) return null;

  let seconds: number;
  if (parts.length === 1) {
    seconds = nums[0]; // bare seconds
  } else if (parts.length === 2) {
    seconds = nums[0] * 60 + nums[1]; // M:SS(.ss)
  } else if (parts.length === 3) {
    seconds = nums[0] * 3600 + nums[1] * 60 + nums[2]; // H:MM:SS(.ss)
  } else {
    return null;
  }
  return seconds < 0 ? null : seconds;
}

/**
 * Format seconds back to a human time. Keeps up to 2 fractional digits (trimmed),
 * so 346.96 → "5:46.96", 349 → "5:49", 3750 → "1:02:30".
 */
export function formatTime(totalSeconds: number): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds) || totalSeconds < 0) return '';
  const whole = Math.floor(totalSeconds);
  const frac = totalSeconds - whole;

  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;

  // Fractional seconds, trimmed: .96 → ".96", .10 → ".1", .00 → "".
  let fracStr = '';
  if (frac > 0) {
    fracStr = frac.toFixed(2).slice(1).replace(/0+$/, '').replace(/\.$/, '');
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(sec)}${fracStr}`;
  }
  return `${m}:${pad(sec)}${fracStr}`;
}
