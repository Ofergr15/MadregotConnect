import { describe, expect, it } from 'vitest';
import { buildMember, median, summarise, type MemberInput } from '@/lib/onboarding/funnel';

const NOW = new Date('2026-10-10T12:00:00Z');
const base = (over: Partial<MemberInput> = {}): MemberInput => ({
  athleteId: 'a1', name: 'Noa', source: 'public-form', requestedAt: '2026-10-01T08:00:00Z', requestStatus: 'approved',
  approvedAt: null, firstSeenAt: null, lastSeenAt: null, garminAt: null, hasGarmin: false, hasStrava: false,
  tourSeenAt: null, setupDoneAt: null, phoneOpenedAt: null, push: [], events: [], ...over,
});

describe('joining funnel', () => {
  it('times every stage from the request', () => {
    const m = buildMember(base({ approvedAt: '2026-10-01T10:00:00Z', firstSeenAt: '2026-10-01T11:00:00Z', garminAt: '2026-10-01T12:30:00Z', push: [{ at: '2026-10-02T08:00:00Z', device: 'iphone' }] }), NOW);
    expect(m.hours).toMatchObject({ approved: 2, opened: 3, watch: 4.5, push: 24 });
    expect(m.devices).toEqual(['iphone']);
    expect(m.stuck).toEqual([]);
  });

  it('flags a request waiting for approval for over a day — the case that lost members', () => {
    const m = buildMember(base({ requestStatus: 'pending', requestedAt: '2026-09-13T20:00:00Z' }), NOW);
    expect(m.stuck.map((s) => s.reason)).toEqual(['awaiting_approval']);
  });

  it('flags approved-but-never-opened, and opened-without-watch-or-push after 48h', () => {
    expect(buildMember(base({ approvedAt: '2026-10-05T08:00:00Z' }), NOW).stuck.map((s) => s.reason)).toEqual(['approved_not_opened']);
    expect(buildMember(base({ approvedAt: '2026-10-05T08:00:00Z', firstSeenAt: '2026-10-05T09:00:00Z' }), NOW).stuck.map((s) => s.reason)).toEqual(['no_watch', 'no_push']);
  });

  it('a reported event supplies the device; the earliest occurrence of a step wins', () => {
    const m = buildMember(base({
      firstSeenAt: '2026-10-01T11:00:00Z',
      events: [
        { step: 'join_open', at: '2026-10-01T09:00:00Z', device: 'computer', source: 'event' },
        { step: 'join_open', at: '2026-10-01T09:30:00Z', device: 'iphone', source: 'event' },
        { step: 'code_verified', at: '2026-10-01T10:00:00Z', device: 'computer', source: 'event' },
      ],
    }), NOW);
    expect(m.timeline.filter((e) => e.step === 'join_open')).toHaveLength(1);
    expect(m.reached.opened).toBe('2026-10-01T10:00:00Z');
    expect(m.stuck.map((s) => s.reason)).toContain('computer_only');
  });

  it('summarises counts and medians, ignoring negative gaps (Strava members open before approval)', () => {
    const a = buildMember(base({ approvedAt: '2026-10-01T10:00:00Z', firstSeenAt: '2026-10-01T11:00:00Z' }), NOW);
    const b = buildMember(base({ athleteId: 'a2', approvedAt: '2026-10-01T14:00:00Z', firstSeenAt: '2026-10-01T09:00:00Z' }), NOW);
    const s = summarise([a, b]);
    expect(s.stages.find((x) => x.stage === 'approved')).toMatchObject({ count: 2, medianHours: 4 });
    expect(s.medianApproveToOpen).toBe(1);
    expect(median([null, 3, 1, -2])).toBe(2);
  });
});
