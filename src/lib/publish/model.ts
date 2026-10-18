import { mentionToken } from '@/lib/feed/mentions';

// The staff's "לפרסם" (mockup publish, C0–C4): a message, a cheer, a survey. Pure rules here;
// the writes are lib/publish/server.ts and the api/admin/publish routes.

export type AudienceMode = 'all' | 'groups' | 'people';
export interface AudienceChoice { mode: AudienceMode; groupIds: string[]; athleteIds: string[] }
export interface AudienceTarget { audience_type: 'all' | 'group' | 'athlete'; audience_id: string | null }

/** One scheduled_notifications row per target: everyone is one row, each pack or person its own. */
export function audienceTargets(c: AudienceChoice): AudienceTarget[] {
  if (c.mode === 'groups') return [...new Set(c.groupIds)].filter(Boolean).map((id) => ({ audience_type: 'group' as const, audience_id: id }));
  if (c.mode === 'people') return [...new Set(c.athleteIds)].filter(Boolean).map((id) => ({ audience_type: 'athlete' as const, audience_id: id }));
  return [{ audience_type: 'all', audience_id: null }];
}

/** Read an audience from a request body. Null = not a valid choice. */
export function readAudience(raw: unknown): AudienceChoice | null {
  const r = (raw || {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : []);
  const mode = r.mode === 'groups' || r.mode === 'people' ? r.mode : r.mode === 'all' || r.mode === undefined ? 'all' : null;
  if (!mode) return null;
  const c: AudienceChoice = { mode, groupIds: ids(r.groupIds), athleteIds: ids(r.athleteIds) };
  if (mode === 'groups' && !c.groupIds.length) return null;
  if (mode === 'people' && !c.athleteIds.length) return null;
  return c;
}

/** "First line = the push's title, the rest its body" — and a one-line message is both. */
export function splitMessage(text: string): { title: string; body: string } {
  const lines = text.trim().split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { title: '', body: '' };
  if (lines.length === 1) return { title: 'מדרגות', body: lines[0] };
  return { title: lines[0].slice(0, 80), body: lines.slice(1).join('\n') };
}

/** Mention tokens as plain names, for a lock screen. */
export function plainText(body: string): string {
  return body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '$1');
}

export const CHEER_REASONS = ['race', 'record', 'milestone', 'comeback', 'birthday', 'other'] as const;
export type CheerReason = typeof CHEER_REASONS[number];

/** The text the cheer composer fills in, the person tagged. `detail` is "מרתון תל אביב ב־2:58:41" and the like. */
export function cheerText(name: string, athleteId: string, reason: CheerReason, detail?: string | null): string {
  const who = mentionToken(name, athleteId);
  const d = detail?.trim();
  switch (reason) {
    case 'race': return `כל הכבוד ${who} על ${d || 'המרוץ'}! 🏁`;
    case 'record': return `כל הכבוד ${who} על שיא אישי חדש${d ? `: ${d}` : ''}! 🏅`;
    case 'milestone': return `כל הכבוד ${who}${d ? ` על ${d}` : ''}! 💯`;
    case 'comeback': return `ברוך/ה השב/ה ${who}! איזה כיף לראות אותך שוב רץ/ה 💪`;
    case 'birthday': return `🎂 היום יום ההולדת של ${who}! מזל טוב 🎉`;
    default: return `כל הכבוד ${who}${d ? ` · ${d}` : ''}! ✨`;
  }
}

export type CloseChoice = 'tomorrow' | 'week' | 'none';

/** When a survey closes: tomorrow / a week from now at 23:59 Israel time; null = never. */
export function closesAt(choice: CloseChoice, now: Date = new Date()): string | null {
  if (choice === 'none') return null;
  const days = choice === 'tomorrow' ? 1 : 7;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(now.getTime() + days * 86400000));
  // 23:59 in Israel; +03:00 in summer, +02:00 in winter — the offset is read for that day.
  const probe = new Date(`${day}T12:00:00Z`);
  const off = /GMT([+-]\d+)/.exec(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).format(probe))?.[1] ?? '+3';
  const sign = off.startsWith('-') ? '-' : '+';
  const hh = String(Math.abs(Number(off))).padStart(2, '0');
  return new Date(`${day}T23:59:00${sign}${hh}:00`).toISOString();
}

/** A record push's url → whose, which distance, which run. */
export function parseRecordUrl(url: string | null | undefined): { athleteId: string; bucket: string; activityId: string | null } | null {
  const m = /\/dashboard\/teammate\/([0-9a-f-]{36})\/records\/([a-z0-9]+)(?:\?new=([0-9a-f-]{36}))?/i.exec(url || '');
  return m ? { athleteId: m[1], bucket: m[2], activityId: m[3] ?? null } : null;
}

export const BUCKET_LABEL: Record<string, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', hm: 'חצי מרתון', fm: 'מרתון' };

export function clock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
