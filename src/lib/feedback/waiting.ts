/**
 * "מחכים לך" — which post-workout feedback is still waiting for a coach (mockup
 * coach-feedback-mockup.html, Ofer 2026-10-19). 17 answers that called for one had
 * none: Eylon reported pain six times. One definition for the tab, the cards and the
 * dot on "ניהול" (api/staff/attention), so the three never disagree.
 *
 * Waiting = it asked for an answer (pain, a request for feedback, or a comment) and no
 * coach has answered since: no reply, no staff message in its thread, not marked
 * handled (coach_reply_at with no text — "טופל בלי הודעה"). A runner writing again in
 * the thread after the answer makes it wait again.
 */

/** How far back the tab and the dot look. Older unanswered feedback is history. */
export const WAITING_DAYS = 60;

export interface FeedbackLike {
  id: string;
  athleteId: string;
  createdAt: string;
  pain: boolean | null;
  painDetail?: string | null;
  wantsFeedback: boolean | null;
  comment: string | null;
  coachReplyAt: string | null;
  messages: Array<{ createdAt: string; fromStaff?: boolean }>;
}

export const asksForAnswer = (f: Pick<FeedbackLike, 'pain' | 'wantsFeedback' | 'comment'>) =>
  f.pain === true || f.wantsFeedback === true || !!f.comment?.trim();

/** When a coach last answered it (a reply, a staff message, or "handled"), or null. */
export function answeredAt(f: FeedbackLike): string | null {
  const times = [f.coachReplyAt, ...f.messages.filter((m) => m.fromStaff).map((m) => m.createdAt)].filter(Boolean) as string[];
  return times.length ? times.sort().at(-1)! : null;
}

export function isWaiting(f: FeedbackLike): boolean {
  if (!asksForAnswer(f)) return false;
  const at = answeredAt(f);
  if (!at) return true;
  return f.messages.some((m) => !m.fromStaff && m.createdAt > at);
}

/** Pain that keeps coming back, by the body part a runner names. */
const BODY_PARTS: Array<{ label: string; re: RegExp }> = [
  { label: 'שין ספלינטס', re: /שין|shin/i },
  { label: 'ברך', re: /ברך|ברכיים|knee/i },
  { label: 'קרסול', re: /קרסול|ankle/i },
  { label: 'גב', re: /גב\b|גב תחתון|back/i },
  { label: 'אכילס', re: /אכילס|achill/i },
  { label: 'כף רגל', re: /כף רגל|כפות|plantar|foot/i },
  { label: 'ירך', re: /ירך|המסטרינג|hamstring|hip/i },
];

export function recurringPain(items: FeedbackLike[], now: Date = new Date()): { label: string; count: number } | null {
  const since = new Date(now.getTime() - 45 * 86_400_000).toISOString();
  let best: { label: string; count: number } | null = null;
  for (const part of BODY_PARTS) {
    const count = items.filter((f) => f.pain && f.createdAt >= since && part.re.test(f.painDetail || '')).length;
    if (count >= 2 && (!best || count > best.count)) best = { label: part.label, count };
  }
  return best;
}

export interface RunnerGroup<T extends FeedbackLike> {
  athleteId: string;
  /** Newest first. */
  items: T[];
  waiting: T[];
  pain: number;
  asks: number;
  /** The oldest waiting one: how long they have waited. */
  since: string | null;
  recurring: { label: string; count: number } | null;
  lastAnsweredAt: string | null;
}

/** One card per runner; who waits with pain first, then who has waited longest. */
export function groupByRunner<T extends FeedbackLike>(items: T[], now: Date = new Date()): RunnerGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const f of items) by.set(f.athleteId, [...(by.get(f.athleteId) || []), f]);
  const groups = [...by.entries()].map(([athleteId, list]) => {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const waiting = sorted.filter(isWaiting);
    const answers = sorted.map(answeredAt).filter(Boolean) as string[];
    return {
      athleteId,
      items: sorted,
      waiting,
      pain: waiting.filter((f) => f.pain).length,
      asks: waiting.filter((f) => f.wantsFeedback).length,
      since: waiting.length ? waiting[waiting.length - 1].createdAt : null,
      recurring: recurringPain(sorted, now),
      lastAnsweredAt: answers.length ? answers.sort().at(-1)! : null,
    };
  });
  return groups.sort((a, b) =>
    Number(b.pain > 0) - Number(a.pain > 0)
    || (a.since ?? '9').localeCompare(b.since ?? '9')
    || (b.lastAnsweredAt ?? '').localeCompare(a.lastAnsweredAt ?? ''));
}
