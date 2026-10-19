/**
 * Making sense of the club's photo folder names (photos module). The folders are
 * named by hand, over two years, by several people: "יום שישי 16.10", "25.9 שישי",
 * "יום שלישי 24/3/26", "יום שישי 22.5.26 - טורבו", "קאמלו 28.2.26" (made on 28.1),
 * "יום שלישי 10.1.99" (made on 9.6), "שבת 28.6 2". And ~25 of them were all created
 * on one day (20.7.2025) when the archive was moved, so createdTime lies too.
 *
 * Two jobs:
 *  - the folder's real DATE — the photos' own capture day first (the camera is the
 *    witness), then the date written in the name, then createdTime;
 *  - a clean TITLE — the date stripped out (the subline says the day), so
 *    "יום שישי 22.5.26 - טורבו" reads "טורבו" and a bare "17.4" reads "שישי 17.4".
 */

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_WORD = `(?:יום\\s+)?(?:${WEEKDAYS.join('|')})`;
// d.m, d/m, d.m.yy, d.m.yyyy — not "3,000", not "5K", not a lone "2026".
const DATE_RE = /(?<![\d.,/])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d,]|[./]\d)/;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/**
 * The date written in the name, if there is a believable one. A two-digit year is
 * taken only when it is a near year ("99" is a typo, not 1999); with no year, the
 * year that puts the day closest to `near` (when the folder was made).
 */
export function dateInName(name: string, near: string): string | null {
  const m = DATE_RE.exec(name);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const nearY = Number(near.slice(0, 4)) || new Date().getUTCFullYear();
  let years: number[] = [nearY - 1, nearY, nearY + 1];
  if (m[3]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (Math.abs(y - nearY) <= 1) years = [y];
  }
  const options = years.filter((y) => validDay(y, mo, d)).map((y) => iso(y, mo, d));
  if (!options.length) return null;
  return near ? options.sort((a, b) => dayDiff(a, near) - dayDiff(b, near))[0] : options[0];
}

/** The day most of the photos were taken on, when most of them agree (a mixed folder has none). */
export function captureDay(times: Array<string | null | undefined>): string | null {
  const days = times
    .map((t) => (t ? t.slice(0, 10).replace(/:/g, '-') : ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > '2000');
  if (!days.length) return null;
  const count = new Map<string, number>();
  for (const d of days) count.set(d, (count.get(d) ?? 0) + 1);
  const [best, n] = [...count].sort((a, b) => b[1] - a[1])[0];
  return n / days.length >= 0.6 ? best : null;
}

/** The folder's day: the automation's tag, then the camera, then the name, then createdTime. */
export function folderDay(f: { tag?: string | null; createdTime?: string | null; name: string; photoTimes: Array<string | null | undefined> }): string {
  const created = (f.createdTime || '').slice(0, 10);
  if (f.tag && /^\d{4}-\d{2}-\d{2}$/.test(f.tag)) return f.tag;
  return captureDay(f.photoTimes) ?? dateInName(f.name, created) ?? created;
}

/**
 * The title without its date. Leading "יום שלישי" goes too — unless the weekday is
 * part of the phrase ("שלישי עם בנט", "רביעי חג"), or nothing but one word would be
 * left ("שישי מסכמת"). A name that was only a day comes back null: the caller shows
 * the standard day label.
 */
export function cleanTitle(name: string): string | null {
  let s = name.replace(DATE_RE, ' ');
  s = s.replace(/(?:^|\s)\d(?=\s*$)/, ' '); // "שבת 28.6 2", "… 15.7 3": a duplicate's counter
  s = s.replace(/\s+/g, ' ').trim().replace(/^[-–·,]\s*|\s*[-–·,]$/g, '').trim();
  const onlyDay = new RegExp(`^${DAY_WORD}$`);
  if (!s || onlyDay.test(s)) return null;
  const lead = new RegExp(`^${DAY_WORD}\\s+`);
  const trail = new RegExp(`\\s+${DAY_WORD}$`);
  let out = s.replace(trail, '');
  const rest = out.replace(lead, '');
  if (rest !== out && !/^(?:עם|חג|ב|של)(?:\s|$)/.test(rest) && rest.includes(' ')) out = rest;
  else if (rest !== out && !/^(?:עם|חג|ב|של)(?:\s|$)/.test(rest)) out = out.replace(/^יום\s+/, '');
  return out.replace(/^[-–·,]\s*|\s*[-–·,]$/g, '').trim() || null;
}

/** Test and scratch folders that should never be shown to members. */
export function isScratchFolder(name: string): boolean {
  return /(^|\s)test(\s|$)/i.test(name) || /(^|\s)בדיקה(\s|$)/.test(name);
}

/**
 * Folders pinned to the top of the photos home, above the latest session — the
 * event of the moment (Ofer 2026-10-19: "מרוץ הסרגל" leads). Matched by name.
 */
export const PINNED_FOLDERS = ['מרוץ הסרגל 2026'];
export const isPinned = (name: string) => PINNED_FOLDERS.some((p) => p.trim() === name.trim());
