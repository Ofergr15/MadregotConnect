import { addDays } from './model';

/**
 * THE WEEK'S POLLS, WRITTEN ON SATURDAY AND SENT WHEN THEIR DAY COMES (Ofer, 10-24: editing
 * inside the screen; mockup week-setup-v2 — "נשלח עם ההתראה של חמישי 08:00").
 *
 * A poll was published the moment it was written. Now it can wait: the Saturday screen keeps
 * it here with the moment it goes out, and the cron tick publishes it then, through the same
 * createAndSendSurvey the publish screen uses. "With the day-before notification" is that
 * day at half an hour before the notification's hour — a club poll published then rides
 * inside "מגיעים מחר?" (lib/surveys dayBeforePushSoon / claimJoinedPolls: one push, not two).
 * Until it goes it can be changed or taken back. In app_settings.week_planned_polls.
 */

export interface PlannedPoll {
  id: string;
  question: string;
  options: string[];
  /** ISO; null = open until closed by hand. */
  closesAt: string | null;
  multi: boolean;
  anonymous: boolean;
  audienceType: 'all' | 'group';
  audienceId: string | null;
  /** When it goes out (ISO). */
  sendAt: string;
  /** "dayBefore:<teamDay>" when it rides with that notification; the screen names it. */
  rides?: string;
  /** Also a card on the feed, to answer in place. */
  feed: boolean;
  by: string;
  byId: string | null;
  /** The publisher's address — createAndSendSurvey's createdBy. */
  email: string;
  createdAt: string;
  /** Set once it went out. */
  surveyId?: string;
  publishedAt?: string;
  error?: string;
}
export type PlannedPollStore = Record<string, PlannedPoll[]>;
export const PLANNED_POLLS_KEY = 'week_planned_polls';

/** The store with this poll added, or replaced by id; old weeks dropped. */
export function upsertPoll(store: PlannedPollStore | null | undefined, week: string, poll: PlannedPoll, today: string): PlannedPollStore {
  const next = prune(store, today);
  const list = (next[week] || []).filter((p) => p.id !== poll.id);
  next[week] = [...list, poll].sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  return next;
}

export function removePoll(store: PlannedPollStore | null | undefined, week: string, id: string, today: string): PlannedPollStore {
  const next = prune(store, today);
  next[week] = (next[week] || []).filter((p) => p.id !== id);
  if (!next[week].length) delete next[week];
  return next;
}

/** What is due: not sent yet, its moment has come. */
export function duePolls(store: PlannedPollStore | null | undefined, nowIso: string): Array<{ week: string; poll: PlannedPoll }> {
  const out: Array<{ week: string; poll: PlannedPoll }> = [];
  for (const [week, list] of Object.entries(store || {})) for (const p of list) if (!p.publishedAt && p.sendAt <= nowIso) out.push({ week, poll: p });
  return out;
}

/** Waiting to go out (the screen's "מתוזמן"). */
export const pendingOf = (list: PlannedPoll[] | undefined) => (list || []).filter((p) => !p.publishedAt);

function prune(store: PlannedPollStore | null | undefined, today: string): PlannedPollStore {
  const cutoff = addDays(today, -35);
  const next: PlannedPollStore = {};
  for (const [w, list] of Object.entries(store || {})) if (w >= cutoff && Array.isArray(list)) next[w] = [...list];
  return next;
}

/** A poll as the screen sends it, checked: the question, two answers at least, a moment to go. */
export function validPoll(x: Partial<PlannedPoll>, nowIso: string): string | null {
  if (!x.question?.trim()) return 'question';
  if ((x.options || []).map((o) => o.trim()).filter(Boolean).length < 2) return 'options';
  if (!x.sendAt || !Number.isFinite(Date.parse(x.sendAt))) return 'sendAt';
  if (x.closesAt && Date.parse(x.closesAt) <= Math.max(Date.parse(x.sendAt), Date.parse(nowIso)) + 5 * 60_000) return 'closesAt';
  return null;
}
