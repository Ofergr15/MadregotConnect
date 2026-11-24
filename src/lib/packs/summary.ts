// ── The weekly digest of a pack's chat, deterministic (b23, migration 218) ──
//
// No model call: counts per day, a keyword pass for pain and logistics, and questions that
// nobody else answered. Pain items name a member's body, so the summary is staff-only
// (GET /api/packs/:id/week-summary); see CLAUDE.md, "Recorded exposure change, 2026-11-24".

import { addDaysToDateStr, israelToday } from '@/lib/utils';

export const PAIN_RE = /כאב|כואב|כואבת|פציע|נפצע|נקע|דלקת|שין ?ספלינט|\bpain\b|\bhurts?\b|injur|\bsore\b|strain|sprain/i;
export const LOGISTICS_RE = /איפה|מתי|באיזו שעה|נקודת מפגש|נפגשים|חניה|הסעה|טרמפ|מיקום|\bwhere\b|\bwhen\b|parking|meet(ing)? point|\bride\b/i;

export interface ChatMessage { id: string; userId: string | null; text: string; createdAt: string }
export interface SummaryItem { kind: 'pain' | 'logistics' | 'question'; athleteId: string | null; text: string; messageId: string }
export interface WeekSummary {
  weekStart: string;
  msgByDay: number[];
  items: SummaryItem[];
  attendance: { date: string; present: number; total: number }[];
}

/** A question nobody else replied to within this many hours is "unanswered". */
export const REPLY_WINDOW_H = 12;

const clip = (s: string) => (s.length > 280 ? `${s.slice(0, 279)}…` : s);

export function summariseWeek(
  weekStart: string,
  messages: ChatMessage[],
  attendance: WeekSummary['attendance'] = [],
): WeekSummary {
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i));
  const inWeek = messages
    .filter((m) => days.includes(israelToday(new Date(m.createdAt))))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const msgByDay = days.map((d) => inWeek.filter((m) => israelToday(new Date(m.createdAt)) === d).length);
  const items: SummaryItem[] = [];
  inWeek.forEach((m, i) => {
    const text = (m.text || '').trim();
    if (!text) return;
    const base = { athleteId: m.userId, text: clip(text), messageId: m.id };
    if (PAIN_RE.test(text)) { items.push({ kind: 'pain', ...base }); return; }
    if (text.endsWith('?') || text.endsWith('？')) {
      // Answered = somebody else wrote within REPLY_WINDOW_H after it; a later unrelated message is not an answer.
      const until = Date.parse(m.createdAt) + REPLY_WINDOW_H * 3_600_000;
      const answered = inWeek.slice(i + 1).some((n) => n.userId !== m.userId && (n.text || '').trim() && Date.parse(n.createdAt) <= until);
      if (!answered) { items.push({ kind: 'question', ...base }); return; }
    }
    if (LOGISTICS_RE.test(text)) items.push({ kind: 'logistics', ...base });
  });
  return { weekStart, msgByDay, items, attendance };
}

/** What a non-staff caller would get: never pain. (The route is staff-only; this is the second line.) */
export function withoutPain(s: WeekSummary): WeekSummary {
  return { ...s, items: s.items.filter((i) => i.kind !== 'pain') };
}
