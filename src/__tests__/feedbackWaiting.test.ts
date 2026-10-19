import { describe, expect, it } from 'vitest';
import { groupByRunner, isWaiting, recurringPain, type FeedbackLike } from '@/lib/feedback/waiting';

const fb = (o: Partial<FeedbackLike> & { id: string }): FeedbackLike => ({
  athleteId: 'eylon', createdAt: '2026-10-01T06:00:00Z', pain: false, painDetail: null, wantsFeedback: false,
  comment: null, coachReplyAt: null, messages: [], ...o,
});

describe('what is waiting for a coach', () => {
  it('pain, a request or a comment with no answer waits; a plain one does not', () => {
    expect(isWaiting(fb({ id: '1', pain: true }))).toBe(true);
    expect(isWaiting(fb({ id: '2', wantsFeedback: true }))).toBe(true);
    expect(isWaiting(fb({ id: '3', comment: 'עליות☠️' }))).toBe(true);
    expect(isWaiting(fb({ id: '4' }))).toBe(false);
  });
  it('a staff message, a reply or "handled" answers it; the runner writing again reopens it', () => {
    expect(isWaiting(fb({ id: '1', pain: true, messages: [{ createdAt: '2026-10-02T06:00:00Z', fromStaff: true }] }))).toBe(false);
    expect(isWaiting(fb({ id: '2', pain: true, coachReplyAt: '2026-10-02T06:00:00Z' }))).toBe(false);
    expect(isWaiting(fb({ id: '3', pain: true, coachReplyAt: '2026-10-02T06:00:00Z', messages: [{ createdAt: '2026-10-03T06:00:00Z', fromStaff: false }] }))).toBe(true);
  });
});

describe('the runner card', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  it('shin splints three times in September is called out', () => {
    const items = [
      fb({ id: 'a', pain: true, painDetail: 'בקטנה shin splints', createdAt: '2026-09-13T06:00:00Z' }),
      fb({ id: 'b', pain: true, painDetail: 'שין ספלינטס', createdAt: '2026-09-21T06:00:00Z' }),
      fb({ id: 'c', pain: true, painDetail: 'בקטנה שין', createdAt: '2026-09-27T06:00:00Z' }),
      fb({ id: 'd', pain: true, painDetail: 'בחילות והקאות', createdAt: '2026-09-25T06:00:00Z' }),
    ];
    expect(recurringPain(items, now)).toEqual({ label: 'שין ספלינטס', count: 3 });
  });
  it('one card per runner, pain first, then whoever has waited longest', () => {
    const g = groupByRunner([
      fb({ id: '1', athleteId: 'roy', comment: 'עופר המלך!', createdAt: '2026-09-12T06:00:00Z' }),
      fb({ id: '2', athleteId: 'ofer', wantsFeedback: true, createdAt: '2026-09-23T06:00:00Z' }),
      fb({ id: '3', athleteId: 'eyal', pain: true, createdAt: '2026-09-20T06:00:00Z' }),
      fb({ id: '4', athleteId: 'eylon', pain: true, createdAt: '2026-10-11T06:00:00Z' }),
      fb({ id: '5', athleteId: 'eylon', wantsFeedback: true, createdAt: '2026-09-10T06:00:00Z' }),
    ], now);
    expect(g.map((x) => x.athleteId)).toEqual(['eylon', 'eyal', 'roy', 'ofer']);
    expect(g[0]).toMatchObject({ pain: 1, asks: 1, since: '2026-09-10T06:00:00Z' });
    expect(g[0].items.map((i) => i.id)).toEqual(['4', '5']);
  });
});
