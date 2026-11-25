import { describe, expect, it } from 'vitest';
import { visibleUnread, type HistoryItem } from '@/lib/notifications/history';
import { readCutoff } from '@/lib/notifications/seen';
import { computeSetupState } from '@/lib/onboarding/setup-tasks';
import { taskHref } from '@/components/onboarding/task-meta';

/** PWA F1 (bell count == highlighted rows) and F2 (setup rows deep-link to the missing field). */

const item = (id: string, unread: boolean, extra: Partial<HistoryItem> = {}): HistoryItem =>
  ({ id, kind: 'custom', title: id, body: '', url: '/dashboard', sentAt: '2026-11-24T08:00:00Z', unread, ...extra });

describe('visibleUnread — the bell and the inbox count the same rows', () => {
  it('counts unread rows only', () => {
    expect(visibleUnread([item('a', true), item('b', false), item('c', true)]).map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('leaves out rows this device already cleared', () => {
    expect(visibleUnread([item('a', true), item('c', true)], new Set(['a'])).map((i) => i.id)).toEqual(['c']);
  });
});

describe('readCutoff — the read cutoff is notifications_seen_at, not last-active', () => {
  it('prefers notifications_seen_at (migration 213)', () => {
    expect(readCutoff({ notifications_seen_at: '2026-11-20T00:00:00Z', last_seen_at: '2026-11-24T00:00:00Z' })).toBe('2026-11-20T00:00:00Z');
  });
  it('falls back to last_seen_at before 213, then to the epoch', () => {
    expect(readCutoff({ last_seen_at: '2026-11-24T00:00:00Z' })).toBe('2026-11-24T00:00:00Z');
    expect(readCutoff({})).toBe('1970-01-01');
  });
  it('a member who joined after 213 (seen_at null) counts from created_at, never last-active', () => {
    expect(readCutoff({ notifications_seen_at: null, last_seen_at: '2026-11-24T09:00:00Z', created_at: '2026-11-23T00:00:00Z' })).toBe('2026-11-23T00:00:00Z');
    expect(readCutoff({ notifications_seen_at: null, last_seen_at: '2026-11-24T09:00:00Z' })).toBe('1970-01-01');
  });
});

describe('setup checklist → the exact missing field', () => {
  const base = {
    dataSource: null, hasGarminAuth: false, hasStravaAuth: false, avatarUrl: null,
    phone: '0501234567', birthDate: null, gender: 'female',
    shirtSize: 'M', pantsSize: null, tightsSize: 'M', socksSize: null, shoeSize: '42',
    pushSubscriptions: 0, groupName: null, hasActiveShoe: false,
  } as unknown as Parameters<typeof computeSetupState>[0];
  const state = computeSetupState(base);
  it('lists the empty personal fields in form order', () => {
    expect(state.tasks.find((t) => t.key === 'personalInfo')?.meta?.missing).toEqual(['birthDate']);
  });
  it('lists the empty kit sizes in form order', () => {
    expect(state.tasks.find((t) => t.key === 'sizes')?.meta?.missing).toEqual(['pantsSize', 'socksSize']);
  });
  it('the deep link carries the field to focus', () => {
    expect(taskHref('sizes', 'pantsSize')).toBe('/dashboard/profile?tab=personalInfo&focus=pantsSize');
    expect(taskHref('personalInfo')).toBe('/dashboard/profile?tab=personalInfo');
  });
});
