/**
 * Scheduled messages and polls for the native "Edit Alarm"-style composer (task 153).
 *
 * The composer's fields, as the iOS alarm editor has them: a time (Israel wall clock), the
 * days it repeats on ("never" = once, on a date), an audience, importance and a push
 * toggle. Pure: validation, the next occurrence and the repeat label. The routes and the
 * dry-run cron (lib/scheduled-composer/server.ts) do the reads and writes.
 */
import { israelWallToUtc } from '@/lib/notifications/scheduling';
import { addDaysToDateStr, israelToday } from '@/lib/utils';

export const MIGRATION_327 = 'migration-327';
export const MIGRATION_327_TEXT = 'צריך להריץ מיגרציה 327';

export const TITLE_MAX = 120;
export const BODY_MAX = 1000;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 8;
export const POLL_OPTION_MAX = 80;

export type ComposerKind = 'message' | 'poll';
export type AudienceType = 'all' | 'group' | 'athlete' | 'academy';
export type Importance = 'normal' | 'high';

export interface ComposerItem {
  kind: ComposerKind;
  titleHe: string;
  bodyHe: string | null;
  pollOptionsHe: string[] | null;
  audienceType: AudienceType;
  audienceId: string | null;
  /** 'HH:MM', Israel. */
  sendTime: string;
  /** 0 = Sunday … 6 = Saturday, sorted, unique. Empty = once, on `onceDate`. */
  repeatDays: number[];
  onceDate: string | null;
  importance: Importance;
  push: boolean;
  enabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The body of a create (`partial: false`) or an edit (`partial: true`, merged onto `base`).
 * Returns every problem at once, so the composer can mark every field.
 */
export function readComposer(raw: unknown, base?: ComposerItem): { item: ComposerItem } | { errors: string[] } {
  if (!raw || typeof raw !== 'object') return { errors: ['invalid body'] };
  const b = raw as Record<string, unknown>;
  const pick = <K extends keyof ComposerItem>(k: K, v: unknown): unknown => (v === undefined && base ? base[k] : v);
  const errors: string[] = [];

  const kind = pick('kind', b.kind) ?? 'message';
  if (kind !== 'message' && kind !== 'poll') errors.push('kind must be message or poll');

  const titleRaw = pick('titleHe', b.titleHe);
  const titleHe = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  if (!titleHe) errors.push('titleHe is required');
  else if (titleHe.length > TITLE_MAX) errors.push(`titleHe is limited to ${TITLE_MAX} characters`);

  const bodyRaw = pick('bodyHe', b.bodyHe);
  const bodyHe = typeof bodyRaw === 'string' && bodyRaw.trim() ? bodyRaw.trim() : null;
  if (bodyHe && bodyHe.length > BODY_MAX) errors.push(`bodyHe is limited to ${BODY_MAX} characters`);

  let pollOptionsHe: string[] | null = null;
  if (kind === 'poll') {
    const opts = pick('pollOptionsHe', b.pollOptionsHe);
    const clean = Array.isArray(opts) ? opts.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean) : [];
    if (clean.length < POLL_OPTIONS_MIN || clean.length > POLL_OPTIONS_MAX) errors.push(`a poll needs ${POLL_OPTIONS_MIN}–${POLL_OPTIONS_MAX} options`);
    if (clean.some((o) => o.length > POLL_OPTION_MAX)) errors.push(`a poll option is limited to ${POLL_OPTION_MAX} characters`);
    if (new Set(clean).size !== clean.length) errors.push('poll options must differ');
    pollOptionsHe = clean;
  }

  const audienceType = pick('audienceType', b.audienceType) ?? 'all';
  if (!['all', 'group', 'athlete', 'academy'].includes(audienceType as string)) errors.push('audienceType must be all, group, athlete or academy');
  const audRaw = pick('audienceId', b.audienceId);
  const needsId = audienceType === 'group' || audienceType === 'athlete';
  const audienceId = needsId && typeof audRaw === 'string' && UUID_RE.test(audRaw) ? audRaw : null;
  if (needsId && !audienceId) errors.push(`audienceId is required for ${audienceType as string}`);

  const sendTime = pick('sendTime', b.sendTime);
  if (typeof sendTime !== 'string' || !TIME_RE.test(sendTime)) errors.push('sendTime must be HH:MM');

  const daysRaw = pick('repeatDays', b.repeatDays) ?? [];
  const daysOk = Array.isArray(daysRaw) && daysRaw.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!daysOk) errors.push('repeatDays must be days 0 (Sunday) to 6 (Saturday)');
  const repeatDays = daysOk ? [...new Set(daysRaw as number[])].sort((x, y) => x - y) : [];

  const onceRaw = pick('onceDate', b.onceDate);
  const onceDate = repeatDays.length === 0 && typeof onceRaw === 'string' && DATE_RE.test(onceRaw) ? onceRaw : null;
  if (daysOk && repeatDays.length === 0 && !onceDate) errors.push('onceDate is required when it does not repeat');

  const importance = pick('importance', b.importance) ?? 'normal';
  if (importance !== 'normal' && importance !== 'high') errors.push('importance must be normal or high');
  const push = pick('push', b.push) ?? true;
  if (typeof push !== 'boolean') errors.push('push must be a boolean');
  const enabled = pick('enabled', b.enabled) ?? true;
  if (typeof enabled !== 'boolean') errors.push('enabled must be a boolean');

  if (errors.length) return { errors };
  return {
    item: {
      kind: kind as ComposerKind, titleHe, bodyHe, pollOptionsHe, audienceType: audienceType as AudienceType, audienceId,
      sendTime: sendTime as string, repeatDays, onceDate, importance: importance as Importance, push: push as boolean, enabled: enabled as boolean,
    },
  };
}

function at(date: string, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return israelWallToUtc(y, m, d, h, min);
}

/** 0 = Sunday for a YYYY-MM-DD calendar date. */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * The first occurrence strictly after `afterMs`, as an ISO instant; null when there is
 * none (a one-off already past, or disabled). Israel wall clock, DST-correct: a 07:00
 * that repeats stays 07:00 on both sides of a clock change.
 */
export function nextOccurrence(
  item: Pick<ComposerItem, 'sendTime' | 'repeatDays' | 'onceDate' | 'enabled'>,
  afterMs: number,
): string | null {
  if (!item.enabled) return null;
  if (item.repeatDays.length === 0) {
    if (!item.onceDate) return null;
    const t = at(item.onceDate, item.sendTime);
    return t > afterMs ? new Date(t).toISOString() : null;
  }
  const today = israelToday(new Date(afterMs));
  for (let k = 0; k <= 7; k++) {
    const day = addDaysToDateStr(today, k);
    if (!item.repeatDays.includes(weekdayOf(day))) continue;
    const t = at(day, item.sendTime);
    if (t > afterMs) return new Date(t).toISOString();
  }
  return null;
}

const DAY_SHORT_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** The repeat row's value, as the alarm editor writes it. */
export function repeatLabelHe(days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b).join(',');
  if (!s) return 'לא חוזר';
  if (s === '0,1,2,3,4,5,6') return 'כל יום';
  if (s === '0,1,2,3,4') return 'ימי חול';
  if (s === '5,6') return 'סוף שבוע';
  return days.length === 1 ? `כל יום ${DAY_SHORT_HE[days[0]]}` : [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_SHORT_HE[d]).join(' ');
}

/** item → table row (snake_case), with its next run computed now. */
export function toRow(item: ComposerItem, nowMs: number) {
  return {
    kind: item.kind, title_he: item.titleHe, body_he: item.bodyHe, poll_options_he: item.pollOptionsHe,
    audience_type: item.audienceType, audience_id: item.audienceId, send_time: item.sendTime, repeat_days: item.repeatDays,
    once_date: item.onceDate, importance: item.importance, push: item.push, enabled: item.enabled,
    next_run_at: nextOccurrence(item, nowMs),
  };
}

export interface ComposerRow {
  id: string; kind: string; title_he: string; body_he: string | null; poll_options_he: string[] | null;
  audience_type: string; audience_id: string | null; send_time: string; repeat_days: number[] | null; once_date: string | null;
  importance: string; push: boolean; enabled: boolean; next_run_at: string | null; last_dry_run_at?: string | null;
  created_at?: string; updated_at?: string;
}

export function fromRow(r: ComposerRow): ComposerItem & { id: string; nextRunAt: string | null; repeatLabelHe: string; lastDryRunAt: string | null } {
  const repeatDays = (r.repeat_days ?? []).slice().sort((a, b) => a - b);
  return {
    id: r.id, kind: r.kind as ComposerKind, titleHe: r.title_he, bodyHe: r.body_he, pollOptionsHe: r.poll_options_he,
    audienceType: r.audience_type as AudienceType, audienceId: r.audience_id, sendTime: r.send_time, repeatDays,
    onceDate: r.once_date, importance: r.importance as Importance, push: r.push, enabled: r.enabled,
    nextRunAt: r.next_run_at, repeatLabelHe: repeatLabelHe(repeatDays), lastDryRunAt: r.last_dry_run_at ?? null,
  };
}

export const isMissingComposerTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /scheduled_composer\w* (does not exist|.*schema cache)/.test(e.message || ''));
