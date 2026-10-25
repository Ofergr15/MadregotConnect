/**
 * "תחילת שבוע" — setting the club's week up in one place (mockup
 * ~/.cache/madregot/week-setup.html, Ofer 2026-10-19). The arithmetic, apart from the
 * screen and the database so it can be tested:
 *
 *  - who owns which part of the week (the coach the workouts, the admin the rest, or
 *    both) and so who may change it;
 *  - the week's notifications as one timeline: the automatic ones the tick sends the
 *    day before each team day (with THIS WEEK's changes to them), the Saturday week
 *    story, and anything scheduled by hand.
 *
 * Nothing here is new behaviour on its own: the tick reads `NotifOverride` for the slot
 * it is about to send (app/api/cron/tick), so "off this week", a new text or a new hour
 * is what actually goes out.
 */

import type { Step } from './log';

export const SECTIONS = ['workouts', 'nutrition', 'quality', 'notifications', 'polls', 'message'] as const;
export type Section = (typeof SECTIONS)[number];
export type Owner = 'coach' | 'admin' | 'both';
export type Owners = Record<Section, Owner>;

/** The coach uploads the workouts and the nutrition; everything else is the admin's. */
export const DEFAULT_OWNERS: Owners = {
  workouts: 'coach', nutrition: 'coach', quality: 'admin', notifications: 'admin', polls: 'admin', message: 'admin',
};

export function normalizeOwners(raw: unknown): Owners {
  const out = { ...DEFAULT_OWNERS };
  if (raw && typeof raw === 'object') {
    for (const s of SECTIONS) {
      const v = (raw as Record<string, unknown>)[s];
      if (v === 'coach' || v === 'admin' || v === 'both') out[s] = v;
    }
  }
  return out;
}

/** The admin (or the super user) changes anything; a coach changes what is theirs. */
export function canEdit(section: Section, owners: Owners, who: { admin: boolean; coach: boolean }): boolean {
  if (who.admin) return true;
  return who.coach && owners[section] !== 'admin';
}

// ── the automatic notifications ───────────────────────────────────────────────────────

/** The tick's own stages that run the day before a team day, plus the Saturday story. */
export type AutoStage = 'dayBefore' | 'eveningBefore' | 'weekStory';

/** This week's change to one automatic notification. Absent fields keep the default. */
export interface NotifOverride {
  off?: boolean;
  title?: string;
  body?: string;
  /** 0–23, Israel time. */
  hour?: number;
  /** One pace group's id instead of everyone (the approval screen's "למי"). */
  audience?: string;
}
/** `{ [weekStart]: { [slotKey]: NotifOverride } }`, in app_settings.week_notif_overrides. */
export type OverrideStore = Record<string, Record<string, NotifOverride>>;
export const OVERRIDES_KEY = 'week_notif_overrides';
export const OWNERS_KEY = 'week_owners';

/** `dayBefore:2` — the stage and the team day it is about; the Saturday story is `weekStory`. */
export const slotKey = (stage: AutoStage, teamDay?: number) => (stage === 'weekStory' ? 'weekStory' : `${stage}:${teamDay}`);

export function overrideFor(store: OverrideStore | null | undefined, weekStart: string, stage: AutoStage, teamDay?: number): NotifOverride | null {
  const o = store?.[weekStart]?.[slotKey(stage, teamDay)];
  return o && typeof o === 'object' ? o : null;
}

/** A push's copy with this week's text in place of the default where one was set. */
export function withOverrideCopy<T extends { title: string; body: string }>(copy: T, o: NotifOverride | null | undefined): T {
  if (!o) return copy;
  return { ...copy, title: o.title?.trim() || copy.title, body: o.body?.trim() || copy.body };
}

/** Store with one slot set (or removed, with `null`); weeks older than three are dropped. */
export function withOverride(store: OverrideStore, weekStart: string, key: string, value: NotifOverride | null, today: string): OverrideStore {
  const next: OverrideStore = {};
  const cutoff = addDays(today, -21);
  for (const [w, slots] of Object.entries(store || {})) if (w >= cutoff) next[w] = { ...slots };
  const week = { ...(next[weekStart] || {}) };
  if (value) week[key] = clean(value); else delete week[key];
  if (Object.keys(week).length) next[weekStart] = week; else delete next[weekStart];
  return next;
}

function clean(o: NotifOverride): NotifOverride {
  const out: NotifOverride = {};
  if (o.off) out.off = true;
  if (o.title?.trim()) out.title = o.title.trim().slice(0, 120);
  if (o.body?.trim()) out.body = o.body.trim().slice(0, 400);
  if (Number.isInteger(o.hour) && o.hour! >= 0 && o.hour! <= 23) out.hour = o.hour;
  if (o.audience && /^[0-9a-f-]{36}$/i.test(o.audience)) out.audience = o.audience;
  return out;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type SlotState = 'sent' | 'off' | 'approve' | 'skipped' | 'scheduled';

export interface TimelineRow {
  key: string;
  stage: AutoStage | 'custom';
  /** The team day it is about (automatic stages). */
  teamDay?: number;
  /** When it goes out, Israel date and hour. */
  date: string;
  hour: number;
  title: string;
  body: string;
  /** The default text, to show what an override changed and to go back to. */
  defaultTitle?: string;
  defaultBody?: string;
  audience: string;
  state: SlotState;
  /** This week's change is in place. */
  changed: boolean;
  /** A scheduled one's row id (custom). */
  id?: string;
  /** This week's one pace group instead of everyone (the override's audience). */
  group?: string | null;
}

export interface TimelineInput {
  weekStart: string;
  teamDays: number[];
  dayBefore: { enabled: boolean; hour: number };
  eveningBefore: { enabled: boolean; hour: number };
  /** Tags the tick has already recorded as fired (`dayBefore:<ws>:<day>`, `report7:<date>`). */
  fired: Set<string>;
  overrides: OverrideStore;
  /** Per team date: does it wait for an admin's OK, and what was decided. */
  approval: (teamDate: string) => 'not_needed' | 'pending' | 'approved' | 'skipped';
  /** The tick's default copy for a stage (Hebrew). */
  copy: (stage: 'dayBefore' | 'eveningBefore', teamDay: number) => { title: string; body: string };
  custom: Array<{ id: string; title: string; body: string; at: string; audience: string; sent: boolean }>;
}

/** The week's notifications in the order they go out. */
export function weekTimeline(x: TimelineInput): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const teamDay of x.teamDays) {
    const teamDate = addDays(x.weekStart, teamDay);
    const date = addDays(teamDate, -1);
    const approval = x.approval(teamDate);
    for (const stage of ['dayBefore', 'eveningBefore'] as const) {
      const cfg = stage === 'dayBefore' ? x.dayBefore : x.eveningBefore;
      if (!cfg.enabled) continue;
      const def = x.copy(stage, teamDay);
      const o = overrideFor(x.overrides, x.weekStart, stage, teamDay);
      const sent = x.fired.has(`${stage}:${x.weekStart}:${teamDay}`);
      rows.push({
        key: slotKey(stage, teamDay), stage, teamDay, date, hour: o?.hour ?? cfg.hour,
        title: o?.title || def.title, body: o?.body || def.body, defaultTitle: def.title, defaultBody: def.body,
        audience: stage === 'dayBefore' ? 'all' : 'noAnswer',
        state: sent ? 'sent' : o?.off ? 'off' : approval === 'pending' ? 'approve' : approval === 'skipped' ? 'skipped' : 'scheduled',
        changed: !!(o && (o.title || o.body || o.hour != null || o.off || o.audience)),
        group: o?.audience ?? null,
      });
    }
  }
  const saturday = addDays(x.weekStart, 6);
  const ws = overrideFor(x.overrides, x.weekStart, 'weekStory');
  rows.push({
    key: 'weekStory', stage: 'weekStory', date: saturday, hour: 12,
    title: ws?.title || 'השבוע שלך', body: ws?.body || 'הסיכום האישי של השבוע, בסטורי', audience: 'ranThisWeek',
    state: x.fired.has(`report7:${saturday}`) ? 'sent' : ws?.off ? 'off' : 'scheduled', changed: !!ws?.off,
  });
  for (const c of x.custom) {
    const d = israelParts(c.at);
    rows.push({ key: `custom:${c.id}`, id: c.id, stage: 'custom', date: d.date, hour: d.hour, title: c.title, body: c.body, audience: c.audience, state: c.sent ? 'sent' : 'scheduled', changed: false });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

export function israelParts(iso: string): { date: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** The UTC instant of `hour`:00 on `date`, Israel time (either offset, DST included). */
export function israelHourToIso(date: string, hour: number): string {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  for (const off of [2, 3]) {
    const at = new Date(guess - off * 3_600_000).toISOString();
    const p = israelParts(at);
    if (p.date === date && p.hour === hour) return at;
  }
  return new Date(guess - 3 * 3_600_000).toISOString();
}

// ── how ready the week is ───────────────────────────────────────────────────────────

/**
 * The Saturday's seven steps in their order (lib/week-setup/log STEPS), and the first one not
 * done — "הבא בתור". Sending to the watches is last: nothing goes out to the runners before
 * everything else is set (Ofer, 10-24). Nutrition, polls and the message may be set aside
 * for a week ("not this week"), which counts as done.
 */
export interface Readiness { done: number; total: number; missing: Step[]; next: Step | null }

export function readiness(x: {
  planStatus: 'none' | 'draft' | 'partial' | 'pushed';
  nutrition: boolean;
  qualityPicked: boolean;
  toApprove: number;
  polls: boolean;
  message: boolean;
}): Readiness {
  const checks: Array<[Step, boolean]> = [
    ['workouts', x.planStatus !== 'none'],
    ['nutrition', x.nutrition],
    ['quality', x.qualityPicked],
    ['notifications', x.toApprove === 0],
    ['polls', x.polls],
    ['message', x.message],
    ['watches', x.planStatus === 'pushed'],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([s]) => s);
  return { done: checks.length - missing.length, total: checks.length, missing, next: missing[0] ?? null };
}
