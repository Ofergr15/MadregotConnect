/**
 * "Did you mean …@gmail.com?" — a typo in the domain of an address is the one mistake a
 * sign-up cannot recover from by itself: every mail after it goes nowhere. Only the
 * domains people here actually use, and only near misses (one or two letters), so a real
 * company domain is never "corrected".
 */
const KNOWN = ['gmail.com', 'walla.co.il', 'walla.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'live.com', 'me.com', 'bezeqint.net', 'netvision.net.il', 'zahav.net.il'];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // A swapped pair ("gmial") is one slip, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The address with its domain fixed, or null when the domain is fine or not a near miss. */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (KNOWN.includes(domain)) return null;
  let best: { d: string; n: number } | null = null;
  for (const k of KNOWN) {
    const n = distance(domain, k);
    if (n > 0 && n <= 2 && (!best || n < best.n)) best = { d: k, n };
  }
  return best ? `${local}@${best.d}` : null;
}
