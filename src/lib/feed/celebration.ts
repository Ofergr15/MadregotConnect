import { cleanPhotosLink } from '@/lib/quality-session/photos';

// Celebrations in the feed (Ofer, 2026-10-18): birthdays as today, and weddings,
// births, achievements, races, anything — with a "watch" button when there is a
// video. A compact card that sits with the redesigned feed's cards, not a banner.
//
// Three payload shapes are read: a birthday post (lib/feed/birthday.ts —
// `birthdayOf`), a cheer from Content (lib/publish — `cheerFor` + `reason`), and a
// celebration made by hand (`kind: 'celebration'`).

export const CELEBRATION_TYPES = {
  birthday: { emoji: '🎂', label: 'יום הולדת', accent: '#E5487A' },
  wedding: { emoji: '💍', label: 'חתונה', accent: '#7A3FD1' },
  baby: { emoji: '👶', label: 'לידה', accent: '#2BA8B5' },
  achievement: { emoji: '🏅', label: 'הישג', accent: '#C7921A' },
  race: { emoji: '🏁', label: 'תחרות', accent: '#16794A' },
  other: { emoji: '🎉', label: 'אחר', accent: '#1525FF' },
} as const;
export type CelebrationType = keyof typeof CELEBRATION_TYPES;

export interface Celebration {
  type: CelebrationType;
  honorees: string[];
  /** http(s) only — a pasted `javascript:` never becomes the watch button. */
  video: string | null;
}

export function toCelebration(payload: Record<string, unknown> | null | undefined): Celebration | null {
  if (!payload) return null;
  const video = cleanPhotosLink(payload.videoLink);
  if (typeof payload.birthdayOf === 'string') return { type: 'birthday', honorees: [payload.birthdayOf], video };
  // A cheer from Content → "ברכה / הישג" (lib/publish): the same thing, by its reason.
  if (typeof payload.cheerFor === 'string') {
    const byReason: Record<string, CelebrationType> = { race: 'race', record: 'achievement', milestone: 'achievement', birthday: 'birthday' };
    return { type: byReason[String(payload.reason)] ?? 'other', honorees: [payload.cheerFor], video };
  }
  if (payload.kind !== 'celebration') return null;
  const t = payload.celebrationType;
  const type: CelebrationType = typeof t === 'string' && t in CELEBRATION_TYPES ? (t as CelebrationType) : 'other';
  const honorees = Array.isArray(payload.honoreeIds) ? payload.honoreeIds.filter((x): x is string => typeof x === 'string') : [];
  return { type, honorees, video };
}

/**
 * The text without the leading emoji the card already draws in its badge — a
 * birthday post's body starts with "🎂 " (and older ones always will).
 */
export function celebrationText(body: string | null, type: CelebrationType): string {
  const b = (body || '').trim();
  const e = CELEBRATION_TYPES[type].emoji;
  return b.startsWith(e) ? b.slice(e.length).trim() : b;
}

/**
 * Is it on the celebrations row today? A birthday on its own day; a celebration
 * made by hand from its day through `until` (inclusive; the same day when unset).
 * Dates are Israel calendar days, YYYY-MM-DD.
 */
export function isCelebrationActive(
  payload: Record<string, unknown> | null | undefined,
  today: string,
  /** The day it was published — a cheer carries no date of its own. */
  publishedDay?: string | null,
): boolean {
  if (!toCelebration(payload)) return false;
  const day = typeof payload!.date === 'string' ? payload!.date : publishedDay ?? null;
  if (!day) return false;
  const until = typeof payload!.until === 'string' && payload!.until >= day ? payload!.until : day;
  return day <= today && today <= until;
}
