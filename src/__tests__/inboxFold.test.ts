import { describe, expect, it } from 'vitest';
import { broadcastCopyIds, closedSurveyIds, foldInbox, isClubItem, waitingFor, type HistoryItem } from '@/lib/notifications/history';
import { clubPostItems, isPlaceholderRow, plainMentions } from '@/lib/notifications/inbox';

// Ofer's real inbox, 2026-10-19 (scheduled_notifications), trimmed to what each rule needs.
const at = (iso: string) => `${iso}:00+03:00`;
const row = (id: string, kind: string, title: string, sentAt: string, extra: Partial<HistoryItem> = {}): HistoryItem =>
  ({ id, kind, title, body: '', url: '/dashboard', sentAt: at(sentAt), unread: false, ...extra });
const NOW = new Date(at('2026-10-19T12:00')).getTime();
const POLL = 'מי בא לרוץ מחר בבוקר (5:00)? 🌅🏃 בחרו דבוקה!';

describe('polls close', () => {
  const polls = ['2026-10-19T08:00', '2026-10-08T08:00', '2026-10-05T08:00', '2026-08-24T18:19'].map((t, i) => row(`p${i}`, 'survey', POLL, t));
  it("keep only today's open", () => {
    expect([...closedSurveyIds(polls, NOW)].sort()).toEqual(['p1', 'p2', 'p3']);
  });
  it('close the newest too once a day and a half has passed', () => {
    expect(closedSurveyIds(polls, NOW + 48 * 3_600_000).has('p0')).toBe(true);
  });
});

describe('what waits for an answer', () => {
  const rsvp = (id: string, t: string) => row(id, 'training_before', 'מחר אימון קבוצתי, יום שלישי 🏃', t, { url: '/dashboard?rsvp=2026-10-18:2' });
  const items = [
    rsvp('r1', '2026-10-19T08:00'), rsvp('r2', '2026-10-19T08:00'),
    row('w', 'post_workout_prompt', '⚡ דיוק ביצוע 83%', '2026-10-16T08:38', { url: '/dashboard/feedback?activity=-20644619908' }),
    rsvp('old', '2026-10-08T08:00'),
  ];
  it('asks about tomorrow once, standing in for both reminders', () => {
    const w = waitingFor(items, NOW);
    expect(w.rsvp).toEqual({ weekStart: '2026-10-18', day: 2 });
    expect(w.hidden.has('r1') && w.hidden.has('r2')).toBe(true);
    expect(w.hidden.has('old')).toBe(false);
  });
  it('lets a three-day-old "how was it" go', () => {
    expect(waitingFor(items, NOW).prompt).toBeNull();
    expect(waitingFor(items, new Date(at('2026-10-17T12:00')).getTime()).prompt?.id).toBe('w');
  });
});

describe('folding', () => {
  it('shows the same notice sent again within two hours once, with the count', () => {
    const t = '⌚ אימון יום ראשון נשלח לשעון';
    const items = ['2026-10-10T23:41', '2026-10-10T23:27', '2026-10-10T23:26', '2026-10-10T23:21', '2026-10-10T22:57'].map((s, i) => row(`s${i}`, 'plan_pushed', t, s));
    const out = foldInbox(items);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'repeat', count: 5 });
  });
  it('folds likes and handled reports into one row each', () => {
    const items = [
      row('k1', 'kudos', 'נתנאל וינר נתן/ה לך כיף על הריצה! 👍', '2026-10-16T11:03', { actorName: 'נתנאל וינר' }),
      row('r1', 'review_resolved', '✅ דיווח #103 טופל', '2026-10-17T21:20'),
      row('k2', 'kudos', 'Amit Lazar נתן/ה לך כיף על הריצה! 👍', '2026-10-13T21:23', { actorName: 'Amit Lazar' }),
      row('r2', 'review_resolved', '✅ דיווח #90 טופל', '2026-10-16T17:50'),
    ];
    const out = foldInbox(items);
    expect(out.map((e) => e.type)).toEqual(['group', 'group']);
  });
});

describe('the club tab', () => {
  it("holds the club's broadcast and its posts", () => {
    expect(isClubItem({ kind: 'custom', toAll: true })).toBe(true);
    expect(isClubItem({ kind: 'custom', toAll: false })).toBe(false);
    expect(isClubItem({ kind: 'club_post' })).toBe(true);
  });
  it("turns the club's posts into rows, without one the club also pushed", () => {
    const posts = [
      { id: 'a', body: 'כל הכבוד @[Shay Noam](94e8) על מרתון אמסטרדם ב־2:45:09! 🏁', occurred_at: '2026-10-18T17:45:00Z' },
      { id: 'b', body: 'גרסה גדולה במדרגות 🚀\nעמוד ריצה חדש', occurred_at: '2026-10-18T18:55:00Z' },
    ];
    const rows = clubPostItems(posts, '2026-10-18T00:00:00Z', new Set(['גרסה גדולה במדרגות 🚀']));
    expect(rows.map((r) => r.title)).toEqual(['כל הכבוד Shay Noam על מרתון אמסטרדם ב־2:45:09! 🏁']);
    expect(rows[0].url).toBe('/feed?item=a');
    expect(plainMentions('@[Shalev Bahalul](ed97)')).toBe('Shalev Bahalul');
  });
  it('shows a broadcast once, not also as a personal copy', () => {
    const t = 'גרסה גדולה במדרגות 🚀';
    expect([...broadcastCopyIds([row('all', 'custom', t, '2026-10-18T20:20', { toAll: true }), row('me', 'custom', t, '2026-10-18T21:55')])]).toEqual(['me']);
  });
  it('drops the "review resolved" twins', () => {
    expect(isPlaceholderRow({ title_he: 'review resolved', body_he: 'review-resolved-6da5' })).toBe(true);
    expect(isPlaceholderRow({ title_he: '✅ דיווח #103 טופל', body_he: 'הייתי רוצה קוביה' })).toBe(false);
  });
});
