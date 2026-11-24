import { addDaysToDateStr } from '@/lib/utils';

/**
 * The academy's weekly moments (academy doc p.2–3; mockup-v3, approved 24.11). Pure: no database, no clock.
 *
 * Four per coach per PLAN week (Sunday-anchored, like weekly_plans):
 *   plan      Saturday before the week, 20:00 — the plan, focus points, goals      (on time by 21:00)
 *   prep_tue  Monday 19:30 — prep for Tuesday's quality session                    (on time by 21:00)
 *   prep_fri  Thursday 19:30 — prep for Friday's quality session                   (on time by 21:00)
 *   summary   Friday 12:00 — the week's summary                                    (on time by 14:00)
 * Times are Israel wall clock. Nothing here sends: `state` only says where a moment stands.
 */
export const MOMENT_KINDS = ['plan', 'prep_tue', 'prep_fri', 'summary'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const isMomentKind = (v: unknown): v is MomentKind => typeof v === 'string' && (MOMENT_KINDS as readonly string[]).includes(v);

/** Days from the plan week's Sunday, the suggested send time, and the "on time" deadline (Israel). */
export const MOMENT_WINDOWS: Record<MomentKind, { day: number; at: string; by: string }> = {
  plan: { day: -1, at: '20:00', by: '21:00' },
  prep_tue: { day: 1, at: '19:30', by: '21:00' },
  prep_fri: { day: 4, at: '19:30', by: '21:00' },
  summary: { day: 5, at: '12:00', by: '14:00' },
};

export type MomentState = 'sent' | 'scheduled' | 'due' | 'late' | 'upcoming';

/** Israel wall clock → an ISO instant, with the given offset (+02:00 winter / +03:00 summer). */
export function israelInstant(date: string, hhmm: string, offset: string): string {
  return `${date}T${hhmm}:00${offset}`;
}

export function windowOf(weekStart: string, kind: MomentKind, offset: string): { date: string; at: string; by: string } {
  const w = MOMENT_WINDOWS[kind];
  const date = addDaysToDateStr(weekStart, w.day);
  return { date, at: israelInstant(date, w.at, offset), by: israelInstant(date, w.by, offset) };
}

/**
 * Where a moment stands at `nowIso`:
 *   sent       sent_at set
 *   scheduled  a send time set and not reached (the coach pressed "send at")
 *   late       past the deadline and not sent
 *   due        the send day has come (from 06:00 of that day) and not past the deadline
 *   upcoming   earlier
 */
export function momentState(
  m: { sent_at?: string | null; scheduled_at?: string | null } | null,
  win: { date: string; by: string },
  nowIso: string,
  offset: string,
): MomentState {
  if (m?.sent_at) return 'sent';
  const now = Date.parse(nowIso);
  if (m?.scheduled_at && Date.parse(m.scheduled_at) > now) return 'scheduled';
  if (now > Date.parse(win.by)) return 'late';
  if (now >= Date.parse(israelInstant(win.date, '06:00', offset))) return 'due';
  return 'upcoming';
}

/** On time = sent before the deadline (the manager's board). Null while it can still be on time. */
export function onTime(m: { sent_at?: string | null } | null, win: { by: string }, nowIso: string): boolean | null {
  if (m?.sent_at) return Date.parse(m.sent_at) <= Date.parse(win.by);
  return Date.parse(nowIso) > Date.parse(win.by) ? false : null;
}

/** What the server pre-writes (a DRAFT only — the coach edits and sends; doc p.1: nothing changes on its own). */
export interface DraftContext {
  /** The quality session the prep is about, e.g. "6×1000 בקצב הקבוצה". */
  session?: string | null;
  /** The week's planned km and session count (Saturday). */
  plannedKm?: number | null;
  sessions?: number | null;
  /** Summary: done vs planned sessions across the coach's trainees, and km run. */
  done?: number | null;
  planned?: number | null;
  km?: number | null;
}

export function draftFor(kind: MomentKind, c: DraftContext): { body: string; goals: Array<{ text: string }> } {
  switch (kind) {
    case 'plan': {
      const size = c.plannedKm ? `${Math.round(c.plannedKm)} ק״מ` : null;
      const n = c.sessions ? `${c.sessions} אימונים` : null;
      const head = [size, n].filter(Boolean).join(', ');
      return {
        body: `${head ? `השבוע ${head}. ` : ''}הדגשים לשבוע:\n• \n• `,
        goals: [{ text: c.sessions ? `${c.sessions} מתוך ${c.sessions} אימונים` : 'כל האימונים של השבוע' }, { text: 'RPE אחרי כל אימון' }],
      };
    }
    case 'prep_tue':
    case 'prep_fri': {
      const day = kind === 'prep_tue' ? 'בשלישי' : 'בשישי';
      return { body: c.session ? `מחר ${c.session}. ` : `לקראת האיכות ${day}: `, goals: [] };
    }
    case 'summary': {
      const parts: string[] = [];
      if (c.planned) parts.push(`${c.done ?? 0} מתוך ${c.planned} אימונים בוצעו`);
      if (c.km) parts.push(`${Math.round(c.km)} ק״מ`);
      return { body: parts.length ? `השבוע: ${parts.join(', ')}. ` : '', goals: [] };
    }
  }
}

/** Clean a PUT body: only these fields, each of its type and size. */
export function cleanMomentInput(raw: unknown): { body: string; goals: Array<{ text: string }>; notes: Record<string, string> } | string {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof r.body !== 'string') return 'body is required';
  const body = r.body.slice(0, 4000);
  const goals = Array.isArray(r.goals)
    ? r.goals.slice(0, 5).map((g) => ({ text: String((g as { text?: unknown })?.text ?? '').trim().slice(0, 120) })).filter((g) => g.text)
    : [];
  const notes: Record<string, string> = {};
  if (r.notes && typeof r.notes === 'object') {
    for (const [k, v] of Object.entries(r.notes as Record<string, unknown>).slice(0, 60)) {
      if (/^[0-9a-f-]{36}$/i.test(k) && typeof v === 'string' && v.trim()) notes[k] = v.trim().slice(0, 500);
    }
  }
  return { body, goals, notes };
}
