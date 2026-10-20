// "נעוץ בראש הפיד" and surveys with more than one answer (mockup publish-preview-v2,
// Ofer 10-20). Both need migration 160 (feed_items.pinned_until, surveys.multi_answer);
// until it is pasted the routes answer MIGRATION_160 and the feed simply has no pins.

export type PinChoice = 'evening' | 'day' | '3d' | 'week' | 'date' | 'close';
export const PIN_CHOICES: PinChoice[] = ['evening', 'day', '3d', 'week', 'date'];
export const PIN_LABEL: Record<PinChoice, string> = {
  evening: 'עד הערב', day: 'יום', '3d': '3 ימים', week: 'שבוע', date: 'עד תאריך…', close: 'עד שנסגר',
};

/** The error code a route answers when 160 is not in the database yet; the screen shows MIGRATION_TEXT. */
export const MIGRATION_160 = 'migration-160';
export const MIGRATION_TEXT = 'צריך להריץ מיגרציה 160';

/** Postgres "column does not exist" (42703), or PostgREST not knowing it (PGRST204 / its schema cache). */
export function isMissingColumn(err: unknown): boolean {
  const e = (err || {}) as { code?: string; message?: string };
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(e.message || '');
}

/** 23:59 Israel on the Israel day `days` after `now` (0 = today). */
export function israelEndOfDay(now: Date, days = 0): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(now.getTime() + days * 86400000));
  const probe = new Date(`${day}T12:00:00Z`);
  const off = /GMT([+-]\d+)/.exec(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).format(probe))?.[1] ?? '+3';
  const sign = off.startsWith('-') ? '-' : '+';
  const hh = String(Math.abs(Number(off))).padStart(2, '0');
  return new Date(`${day}T23:59:00${sign}${hh}:00`);
}

/**
 * Until when a post stays first. `date` is the editor's own (an ISO string); `close`
 * is a survey's closing time. Null = not pinned, or a time already past.
 */
export function pinUntil(choice: PinChoice | null, now: Date, opts: { date?: string | null; closesAt?: string | null } = {}): string | null {
  if (!choice) return null;
  let at: Date | null = null;
  switch (choice) {
    case 'evening': at = israelEndOfDay(now, 0); break;
    case 'day': at = new Date(now.getTime() + 86400000); break;
    case '3d': at = new Date(now.getTime() + 3 * 86400000); break;
    case 'week': at = new Date(now.getTime() + 7 * 86400000); break;
    case 'date': at = opts.date && !Number.isNaN(Date.parse(opts.date)) ? new Date(opts.date) : null; break;
    case 'close': at = opts.closesAt ? new Date(opts.closesAt) : new Date(now.getTime() + 7 * 86400000); break;
  }
  return at && at.getTime() > now.getTime() ? at.toISOString() : null;
}

export function readPinChoice(v: unknown): PinChoice | null {
  return typeof v === 'string' && (['evening', 'day', '3d', 'week', 'date', 'close'] as string[]).includes(v) ? (v as PinChoice) : null;
}

/** Pinned first, the newest pin first; everything else keeps the feed's own order. */
export function orderPinned<T extends { id: string; pinnedUntil?: string | null; occurredAt: string }>(items: T[], now: Date): { pinned: T[]; rest: T[] } {
  const live = (i: T) => !!i.pinnedUntil && Date.parse(i.pinnedUntil) > now.getTime();
  const pinned = items.filter(live).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const ids = new Set(pinned.map((p) => p.id));
  return { pinned, rest: items.filter((i) => !ids.has(i.id)) };
}

/**
 * An athlete's answers after tapping option `i`. One answer: the tap replaces it.
 * More than one allowed: the tap adds or removes that option (at least one may be
 * removed down to none — "no answer" is honest).
 */
export function nextAnswers(current: number[], i: number, multi: boolean): number[] {
  if (!multi) return [i];
  return current.includes(i) ? current.filter((x) => x !== i) : [...current, i].sort((a, b) => a - b);
}

/** "עד מחר 19:00" / "עד ה׳ 22.10" — the pin's chip. */
export function untilLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(x);
  const time = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  if (day(d) === day(now)) return `עד היום ${time}`;
  if (day(d) === day(new Date(now.getTime() + 86400000))) return `עד מחר ${time}`;
  const wd = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][new Date(`${day(d)}T12:00:00Z`).getUTCDay()];
  const [, m, dd] = day(d).split('-');
  return `עד ${wd} ${Number(dd)}.${m}`;
}
