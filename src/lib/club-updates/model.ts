/**
 * "עדכונים מהמועדון" — the pure rules (mockup ~/.cache/madregot/club-updates/full-mockup.html).
 *
 * Short updates from the staff, one stream. In the feed they are one card: full while the
 * newest update is under an hour old, one line until it is a day old, and nothing after
 * that — nothing at all when nothing was posted (Ofer, 2026-10-18).
 */

/** What a member can react with: one tap each, no written comments (keeps the stream readable). */
export const REACTIONS = ['🔥', '❤️', '👏', '💪', '😮', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (v: unknown): v is Reaction => typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);

/** Visible characters (a mention counts as its @name). An update, not a post. */
export const MAX_CHARS = 280;
/** The window in which "ביטול" still stops the push. */
export const UNDO_MS = 6000;
/** A delete can be taken back this long after. */
export const RESTORE_MS = 15_000;
export const LIVE_MS = 60 * 60_000;
export const FEED_MS = 24 * 60 * 60_000;
/** The stream asks for new updates this often while it is on screen. */
export const POLL_MS = 20_000;

const TOKEN = /@\[([^\]]+)\]\(([0-9a-f-]{36})\)/gi;

/** The text as it reads, mentions as @name. */
export function plainText(body: string): string {
  return body.replace(TOKEN, (_m, name: string) => `@${name}`);
}

export const visibleLength = (body: string) => [...plainText(body)].length;

export type FeedState = 'live' | 'quiet' | 'hidden';

/** How the feed shows the stream, from its newest update. */
export function feedState(newestAt: string | null | undefined, now: number): FeedState {
  if (!newestAt) return 'hidden';
  const age = now - Date.parse(newestAt);
  if (!Number.isFinite(age)) return 'hidden';
  if (age < LIVE_MS) return 'live';
  if (age < FEED_MS) return 'quiet';
  return 'hidden';
}

export interface ClubUpdatesConfig {
  /** Off until the admin switches it on; while off only the admin sees it, to try it. */
  enabled: boolean;
  /** Who may write, besides the admin. */
  writerIds: string[];
}

export const DEFAULT_CONFIG: ClubUpdatesConfig = { enabled: false, writerIds: [] };

export function readConfigValue(raw: string | null | undefined): ClubUpdatesConfig {
  try {
    const v = JSON.parse(raw || '{}') as Partial<ClubUpdatesConfig>;
    return {
      enabled: v.enabled === true,
      writerIds: Array.isArray(v.writerIds) ? v.writerIds.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export interface Access { admin: boolean; canWrite: boolean; canRead: boolean }

/** The admin always writes and edits everything; members read once it is on. */
export function accessFor(cfg: ClubUpdatesConfig, athleteId: string | null, admin: boolean): Access {
  const writer = !!athleteId && cfg.writerIds.includes(athleteId);
  return { admin, canWrite: admin || (cfg.enabled && writer), canRead: admin || cfg.enabled };
}

/** Whether `athleteId` may edit / pin / delete an update by `authorId`. */
export const mayEdit = (access: Access, athleteId: string | null, authorId: string) =>
  access.admin || (access.canWrite && !!athleteId && athleteId === authorId);

/** "עכשיו" / "לפני 5 דק׳" / "לפני 3 שעות" — the stream's header and the quiet row. */
export function agoHe(at: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
}
