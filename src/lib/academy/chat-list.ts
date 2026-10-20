import type { InboxRow } from './thread';
import { personMatches } from '@/lib/search/match';

// ── The academy chat list (mockup academy-chat/chat.html, Ofer 10-20) ────────
//
// Messenger-shaped, but not Messenger-ordered all the way down: the trainees owed an
// answer (they wrote last) stay pinned on top, in buildInbox's order, so the oldest
// unanswered question is still the first row. Everyone else is by newest message,
// the way any chat app reads. Pure, so the order is pinned by tests and not by a
// component.

/** A row of the chat list: the inbox row plus what the list route adds. */
export interface ChatRow extends InboxRow {
  /** The caller is one of this trainee's coaches ("שלי"). */
  mine?: boolean;
  /** The trainee has read the newest message (only meaningful when it is staff's). */
  seenByTrainee?: boolean;
  avatarUrl?: string | null;
}

export type ChatFilter = 'all' | 'unread' | 'waiting' | 'mine';

const at = (r: ChatRow) => (r.lastAt ? Date.parse(r.lastAt) : 0);

/** Has this thread had any message at all. */
export const hasThread = (r: ChatRow) => !!r.lastAt;

/** "ממתינים לתשובה" first (inbox order), then by newest message, never-written last by name. */
export function chatSections(rows: ChatRow[], filter: ChatFilter = 'all', query = ''): { waiting: ChatRow[]; recent: ChatRow[] } {
  const q = query.trim().toLowerCase();
  const keep = rows.filter((r) => {
    if (filter === 'unread' && !(r.unreadCount > 0)) return false;
    if (filter === 'waiting' && r.reason !== 'awaiting_reply') return false;
    if (filter === 'mine' && !r.mine) return false;
    if (!q) return true;
    return personMatches(r.name, q, r.lastText);
  });
  const waiting = keep.filter((r) => r.reason === 'awaiting_reply');
  const recent = keep
    .filter((r) => r.reason !== 'awaiting_reply')
    .sort((a, b) => at(b) - at(a) || a.name.localeCompare(b.name, 'he'));
  return { waiting, recent };
}

/** The counts on the filter chips. */
export function chatCounts(rows: ChatRow[]) {
  return {
    unread: rows.filter((r) => r.unreadCount > 0).length,
    waiting: rows.filter((r) => r.reason === 'awaiting_reply').length,
    mine: rows.filter((r) => r.mine).length,
  };
}

const TZ = 'Asia/Jerusalem';
const dayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** The row's time: 08:12 today, אתמול, the weekday letter this week, else 14.10. */
export function chatTimeLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = dayOf(d);
  const today = dayOf(now);
  if (day === today) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const days = Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
  if (days === 1) return 'אתמול';
  if (days > 1 && days < 7) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    return LETTER[dow];
  }
  const [, m, dd] = day.split('-');
  return `${Number(dd)}.${Number(m)}`;
}

/**
 * The preview line. Mine starts "את:"/"אתה:" by the viewer's gender ("אני:" when it
 * is not known); a message with no text is the weekly review or a photo.
 */
export function chatPreview(row: ChatRow, viewerId: string | null, viewerGender?: string | null): { text: string; mine: boolean } {
  if (!row.lastAt) return { text: 'אין עדיין הודעות · להתחיל שיחה', mine: false };
  const mine = !!viewerId && row.lastAuthorId === viewerId;
  const body = row.lastText || '📋 משוב / קובץ';
  const me = viewerGender === 'female' ? 'את' : viewerGender === 'male' ? 'אתה' : 'אני';
  return { text: mine ? `${me}: ${body}` : body, mine };
}
