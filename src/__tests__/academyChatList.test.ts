import { describe, it, expect } from 'vitest';
import { chatCounts, chatPreview, chatSections, chatTimeLabel, type ChatRow } from '@/lib/academy/chat-list';
import { snapshotFromMessages } from '@/lib/academy/thread';

/** The academy chat list (mockup academy-chat/chat.html, Ofer 10-20). */
const row = (o: Partial<ChatRow> & { athleteId: string; name: string }): ChatRow => ({
  lastTraineeMessageAt: null, lastStaffMessageAt: null, unreadCount: 0, reason: 'quiet',
  waitingHours: null, quietDays: null, urgency: 0, lastAt: null, lastAuthorId: null, lastText: null, ...o,
});

const now = new Date('2026-10-20T09:00:00Z'); // 12:00 in Israel, a Tuesday

describe('the order', () => {
  const rows = [
    row({ athleteId: 'a', name: 'אורי', reason: 'awaiting_reply', lastAt: '2026-10-19T08:00:00Z' }),
    row({ athleteId: 'n', name: 'נועה', reason: 'awaiting_reply', lastAt: '2026-10-20T05:12:00Z', unreadCount: 2 }),
    row({ athleteId: 'd', name: 'דנה', lastAt: '2026-10-20T07:40:00Z', mine: true }),
    row({ athleteId: 'y', name: 'יובל', lastAt: '2026-10-18T07:40:00Z', unreadCount: 1 }),
    row({ athleteId: 'm', name: 'מאיה', reason: 'silent' }),
  ];

  it('owed an answer pinned on top in the inbox order; the rest by newest message, never-written last', () => {
    const { waiting, recent } = chatSections(rows);
    expect(waiting.map((r) => r.athleteId)).toEqual(['a', 'n']);
    expect(recent.map((r) => r.athleteId)).toEqual(['d', 'y', 'm']);
  });

  it('filters: unread, waiting for me, mine, and search over name and last text', () => {
    const ids = (f: Parameters<typeof chatSections>[1], q = '') => {
      const s = chatSections(rows, f, q);
      return [...s.waiting, ...s.recent].map((r) => r.athleteId);
    };
    expect(ids('unread')).toEqual(['n', 'y']);
    expect(ids('waiting')).toEqual(['a', 'n']);
    expect(ids('mine')).toEqual(['d']);
    expect(ids('all', 'דנ')).toEqual(['d']);
    expect(chatCounts(rows)).toEqual({ unread: 2, waiting: 2, mine: 1 });
  });

  it('search finds a word in the last message', () => {
    const r = [row({ athleteId: 'x', name: 'רוני', lastAt: '2026-10-20T05:00:00Z', lastText: 'הברך כואבת' })];
    expect(chatSections(r, 'all', 'ברך').recent).toHaveLength(1);
  });
});

describe('the time on a row', () => {
  it('today HH:MM, yesterday, the weekday letter this week, else d.m — Israel time', () => {
    expect(chatTimeLabel('2026-10-20T05:12:00Z', now)).toBe('08:12');
    expect(chatTimeLabel('2026-10-19T20:30:00Z', now)).toBe('אתמול'); // 23:30 Monday
    expect(chatTimeLabel('2026-10-19T21:30:00Z', now)).toBe('00:30'); // already Tuesday in Israel
    expect(chatTimeLabel('2026-10-16T08:00:00Z', now)).toBe('ו׳');
    expect(chatTimeLabel('2026-10-11T08:00:00Z', now)).toBe('11.10');
    expect(chatTimeLabel(null, now)).toBe('');
  });
});

describe('the preview line', () => {
  const r = row({ athleteId: 't', name: 'דנה', lastAt: '2026-10-20T05:00:00Z', lastAuthorId: 'coach-1', lastText: 'מעולה' });
  it('mine starts with את:/אתה: by the viewer, אני: when not known', () => {
    expect(chatPreview(r, 'coach-1', 'female')).toEqual({ text: 'את: מעולה', mine: true });
    expect(chatPreview(r, 'coach-1', 'male').text).toBe('אתה: מעולה');
    expect(chatPreview(r, 'coach-1', null).text).toBe('אני: מעולה');
    expect(chatPreview(r, 'someone-else', 'male')).toEqual({ text: 'מעולה', mine: false });
  });
  it('a thread nobody wrote in invites a first message', () => {
    expect(chatPreview(row({ athleteId: 'm', name: 'מאיה' }), 'coach-1').text).toBe('אין עדיין הודעות · להתחיל שיחה');
  });
});

describe('the snapshot carries the newest message time and author', () => {
  it('whatever order the messages come in', () => {
    const s = snapshotFromMessages('t', 'דנה', [
      { created_at: '2026-10-20T07:00:00Z', text: 'שני', user: { id: 'coach' } },
      { created_at: '2026-10-19T07:00:00Z', text: 'ראשון', user: { id: 't' } },
    ], 0);
    expect(s.lastAt).toBe('2026-10-20T07:00:00.000Z');
    expect(s.lastAuthorId).toBe('coach');
    expect(s.lastText).toBe('שני');
  });
});
