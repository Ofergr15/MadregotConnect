import { describe, expect, it } from 'vitest';
import {
  academyTestUrl, academyThreadUrl, readAcademyDeepLink, upgradeLegacyAcademyUrl,
} from '@/lib/academy/deep-links';
import { shapeInboxItem } from '@/lib/notifications/inbox';
import { REMINDER_URL, reminderRow } from '@/lib/academy/testReminders';

/**
 * Where an academy push lands. One scheme, written by every sender and read by the
 * academy page — so the builder, the reader and the inbox's rewrite of rows sent
 * before the scheme existed are all pinned here together.
 */

describe('the urls a sender writes', () => {
  it('a thread message opens the conversation from the recipient\'s side', () => {
    expect(academyThreadUrl({ recipientIsStaff: false, traineeId: 't1' })).toBe('/dashboard/academy?thread=mine');
    expect(academyThreadUrl({ recipientIsStaff: true, traineeId: 't1' })).toBe('/dashboard/academy?tab=threads&thread=t1');
    expect(academyThreadUrl({ recipientIsStaff: true, traineeId: null })).toBe('/dashboard/academy?tab=threads');
  });

  it('a test reminder raises the test card for the trainee, the tests tab for staff', () => {
    expect(academyTestUrl({ recipientIsStaff: false })).toBe('/dashboard/academy?test=mine');
    expect(academyTestUrl({ recipientIsStaff: true })).toBe('/dashboard/academy?tab=tests');
    expect(REMINDER_URL).toBe('/dashboard/academy?test=mine');
  });

  it('the reminder rows are written with it', () => {
    const row = reminderRow({
      which: 'before', kind: 'academy_test_before', runAt: '2026-10-06T04:00:00.000Z',
      titleHe: 't', bodyHe: 'b', titleEn: 't', bodyEn: 'b',
    }, 'a1');
    expect(row.url).toBe('/dashboard/academy?test=mine');
  });
});

describe('the page reading them', () => {
  const params = (q: string) => new URLSearchParams(q);
  it('reads the three parameters', () => {
    expect(readAcademyDeepLink(params('thread=mine'))).toEqual({ tab: null, thread: 'mine', test: false });
    expect(readAcademyDeepLink(params('tab=threads&thread=t1'))).toEqual({ tab: 'threads', thread: 't1', test: false });
    expect(readAcademyDeepLink(params('test=mine'))).toEqual({ tab: null, thread: null, test: true });
    expect(readAcademyDeepLink(params(''))).toEqual({ tab: null, thread: null, test: false });
  });
});

describe('notifications already sent with the bare academy url', () => {
  it('upgrades a thread row for the trainee and for staff', () => {
    expect(upgradeLegacyAcademyUrl('academy_message', '/dashboard/academy', { viewerIsStaff: false, actorAthleteId: 'coach-1' }))
      .toBe('/dashboard/academy?thread=mine');
    expect(upgradeLegacyAcademyUrl('academy_message', '/dashboard/academy', { viewerIsStaff: true, actorAthleteId: 't1' }))
      .toBe('/dashboard/academy?tab=threads&thread=t1');
    expect(upgradeLegacyAcademyUrl('academy_feedback', '/dashboard/academy', { viewerIsStaff: false }))
      .toBe('/dashboard/academy?thread=mine');
  });

  it('upgrades a test reminder', () => {
    expect(upgradeLegacyAcademyUrl('academy_test_after', '/dashboard/academy', { viewerIsStaff: false }))
      .toBe('/dashboard/academy?test=mine');
  });

  it('leaves everything else exactly as stored', () => {
    expect(upgradeLegacyAcademyUrl('academy_message', '/dashboard/academy?tab=threads', { viewerIsStaff: true })).toBe('/dashboard/academy?tab=threads');
    expect(upgradeLegacyAcademyUrl('academy_joined', '/dashboard/academy', { viewerIsStaff: false })).toBe('/dashboard/academy');
    expect(upgradeLegacyAcademyUrl('like', '/feed', { viewerIsStaff: false })).toBe('/feed');
  });

  it('is applied by the inbox when it knows the viewer', () => {
    const row = {
      id: 'n1', kind: 'academy_message', title_he: 't', body_he: 'b', url: '/dashboard/academy',
      last_sent_at: '2026-10-05T10:00:00Z', actor_athlete_id: 't1',
    };
    expect(shapeInboxItem(row, '1970-01-01', { isStaff: true }).url).toBe('/dashboard/academy?tab=threads&thread=t1');
    expect(shapeInboxItem(row, '1970-01-01', { isStaff: false }).url).toBe('/dashboard/academy?thread=mine');
    // A caller that does not know the viewer gets the stored url.
    expect(shapeInboxItem(row, '1970-01-01').url).toBe('/dashboard/academy');
  });
});
