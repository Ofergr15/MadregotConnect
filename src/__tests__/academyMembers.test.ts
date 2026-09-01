import { describe, expect, it } from 'vitest';
import {
  ATTENTION_ORDER,
  INACTIVE_DAYS,
  LOW_ADHERENCE,
  completionRateOf,
  deriveAttention,
  emptyTeamTotals,
  rollupGroups,
  rollupTeam,
  type AcademyMember,
  type AttentionInput,
} from '@/lib/academy/members';
import { fmtRate, rateColor, shiftWeek, sundayOf, initialsOf, fmtWeekRange } from '@/components/academy/types';

// Coverage for the academy centre's judgement calls — the rules that decide
// which member a coach gets sent after, and what the academy's headline number
// says. All pure; no Supabase involved.

const attn = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  approved: true,
  hasWatch: true,
  daysSinceActivity: 1,
  weekRuns: 3,
  plannedCount: 4,
  completionRate: 1,
  ...over,
});

const member = (over: Partial<AcademyMember> = {}): AcademyMember => ({
  athleteId: 'a1',
  name: 'Athlete',
  email: 'a@example.com',
  avatarUrl: null,
  groupId: 'g1',
  groupName: 'Group 1',
  status: 'active',
  role: 'academy_user',
  approved: true,
  hasWatch: true,
  hasGarmin: true,
  hasStrava: false,
  joinedAt: null,
  weekKm: 10,
  weekRuns: 3,
  weekDurationMin: 60,
  totalKm: 100,
  totalRuns: 30,
  lastActivityAt: '2026-08-31T06:00:00Z',
  daysSinceActivity: 1,
  plannedCount: 4,
  completedCount: 4,
  completionRate: 1,
  attention: [],
  ...over,
});

describe('completionRateOf', () => {
  it('returns null when nothing was planned, not 0', () => {
    // "We never gave them a plan" and "they did none of their plan" are
    // different problems; rendering both as 0% sends the coach after the wrong
    // person.
    expect(completionRateOf(0, 0)).toBeNull();
  });

  it('returns a real 0 when a plan existed and nothing was done', () => {
    expect(completionRateOf(4, 0)).toBe(0);
  });

  it('divides completed by planned', () => {
    expect(completionRateOf(4, 3)).toBe(0.75);
  });
});

describe('deriveAttention', () => {
  it('flags nothing for a connected, approved, on-plan member', () => {
    expect(deriveAttention(attn())).toEqual([]);
  });

  it('flags an unapproved member', () => {
    expect(deriveAttention(attn({ approved: false }))).toContain('not_approved');
  });

  it('flags a member with neither watch connected', () => {
    expect(deriveAttention(attn({ hasWatch: false }))).toContain('no_watch');
  });

  it('treats never-active as inactive', () => {
    expect(deriveAttention(attn({ daysSinceActivity: null }))).toContain('inactive');
  });

  it('flags inactive at the threshold, not just past it', () => {
    expect(deriveAttention(attn({ daysSinceActivity: INACTIVE_DAYS }))).toContain('inactive');
    expect(deriveAttention(attn({ daysSinceActivity: INACTIVE_DAYS - 1, weekRuns: 2 }))).not.toContain('inactive');
  });

  it('does not report both inactive and no_runs for the same silence', () => {
    // One underlying fact — a member who hasn't run in a month has also not run
    // this week — must not list the same person twice under two headings.
    const reasons = deriveAttention(attn({ daysSinceActivity: 30, weekRuns: 0 }));
    expect(reasons).toContain('inactive');
    expect(reasons).not.toContain('no_runs');
  });

  it('reports no_runs for a recently-active member who skipped this week', () => {
    const reasons = deriveAttention(attn({ daysSinceActivity: 8, weekRuns: 0, completionRate: 1 }));
    expect(reasons).toContain('no_runs');
    expect(reasons).not.toContain('inactive');
  });

  it('does not report low_adherence when there was no plan to adhere to', () => {
    const reasons = deriveAttention(attn({ plannedCount: 0, completionRate: null }));
    expect(reasons).toContain('no_plan');
    expect(reasons).not.toContain('low_adherence');
  });

  it('flags low adherence strictly below the threshold', () => {
    expect(deriveAttention(attn({ completionRate: LOW_ADHERENCE - 0.01 }))).toContain('low_adherence');
    expect(deriveAttention(attn({ completionRate: LOW_ADHERENCE }))).not.toContain('low_adherence');
  });

  it('reports reasons in severity order, so a one-badge row shows the worst', () => {
    const reasons = deriveAttention(attn({
      approved: false, hasWatch: false, daysSinceActivity: null, plannedCount: 0, completionRate: null,
    }));
    const positions = reasons.map((r) => ATTENTION_ORDER.indexOf(r));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(reasons[0]).toBe('not_approved');
  });

  it('has a style-order entry for every reason it can emit', () => {
    // Guards the `reason_*` translation keys and the badge palette from drifting
    // out of sync with the rules: any new reason must be added to the order.
    const everyReason = new Set([
      ...deriveAttention(attn({ approved: false, hasWatch: false, daysSinceActivity: null, plannedCount: 0, completionRate: null })),
      ...deriveAttention(attn({ daysSinceActivity: 8, weekRuns: 0 })),
      ...deriveAttention(attn({ completionRate: 0.1 })),
    ]);
    for (const r of everyReason) expect(ATTENTION_ORDER).toContain(r);
    expect(ATTENTION_ORDER).toHaveLength(6);
  });
});

describe('rollupGroups', () => {
  it('buckets unassigned members instead of dropping them, and sorts them last', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', groupId: null, groupName: null }),
      member({ athleteId: '2', groupId: null, groupName: null }),
      member({ athleteId: '3', groupId: 'g1', groupName: 'Group 1' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].groupId).toBe('g1');
    expect(groups[groups.length - 1].groupId).toBeNull();
    expect(groups[groups.length - 1].members).toBe(2);
  });

  it('sorts named groups by size', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', groupId: 'small', groupName: 'Small' }),
      member({ athleteId: '2', groupId: 'big', groupName: 'Big' }),
      member({ athleteId: '3', groupId: 'big', groupName: 'Big' }),
    ]);
    expect(groups.map((g) => g.groupId)).toEqual(['big', 'small']);
  });

  it("weights a group's adherence by planned sessions, not by member", () => {
    // 1 of 1 and 1 of 5 is 2/6, not the 60% a mean of 100% and 20% would give.
    const groups = rollupGroups([
      member({ athleteId: '1', plannedCount: 1, completedCount: 1 }),
      member({ athleteId: '2', plannedCount: 5, completedCount: 1 }),
    ]);
    expect(groups[0].completionRate).toBeCloseTo(2 / 6);
  });

  it('reports a null rate for a group nobody planned for', () => {
    const groups = rollupGroups([member({ plannedCount: 0, completedCount: 0 })]);
    expect(groups[0].completionRate).toBeNull();
  });

  it('sums weekly km without float drift', () => {
    const groups = rollupGroups([
      member({ athleteId: '1', weekKm: 0.1 }),
      member({ athleteId: '2', weekKm: 0.2 }),
    ]);
    expect(groups[0].weekKm).toBe(0.3);
  });
});

describe('rollupTeam', () => {
  it('counts only members who actually ran as active', () => {
    const team = rollupTeam([
      member({ athleteId: '1', weekRuns: 2 }),
      member({ athleteId: '2', weekRuns: 0 }),
    ]);
    expect(team.members).toBe(2);
    expect(team.activeThisWeek).toBe(1);
  });

  it('counts members with any attention flag once, regardless of how many', () => {
    const team = rollupTeam([
      member({ athleteId: '1', attention: ['no_watch', 'inactive', 'no_plan'] }),
      member({ athleteId: '2', attention: [] }),
    ]);
    expect(team.needsAttention).toBe(1);
  });

  it('weights club adherence by planned sessions, not by athlete', () => {
    const team = rollupTeam([
      member({ athleteId: '1', plannedCount: 1, completedCount: 1 }),
      member({ athleteId: '2', plannedCount: 5, completedCount: 1 }),
    ]);
    expect(team.planned).toBe(6);
    expect(team.completed).toBe(2);
    expect(team.completionRate).toBeCloseTo(2 / 6);
  });

  it('reports a null rate rather than 0% when the academy has no plans', () => {
    const team = rollupTeam([member({ plannedCount: 0, completedCount: 0 })]);
    expect(team.completionRate).toBeNull();
  });

  it('counts connected and approved separately', () => {
    const team = rollupTeam([
      member({ athleteId: '1', hasWatch: false, approved: true }),
      member({ athleteId: '2', hasWatch: true, approved: false }),
    ]);
    expect(team.connected).toBe(1);
    expect(team.approved).toBe(1);
  });
});

describe('emptyTeamTotals', () => {
  it('matches the shape rollupTeam returns for an empty academy', () => {
    // The route short-circuits on an empty roster; the two shapes must agree or
    // the overview renders undefined tiles for a brand-new academy.
    expect(emptyTeamTotals()).toEqual(rollupTeam([]));
  });
});

describe('fmtRate / rateColor', () => {
  it('renders an em dash for "no plan" and a percent for a real rate', () => {
    expect(fmtRate(null)).toBe('—');
    expect(fmtRate(0)).toBe('0%');
    expect(fmtRate(0.755)).toBe('76%');
  });

  it('colours by band, with a neutral colour for no plan', () => {
    expect(rateColor(null)).toContain('slate');
    expect(rateColor(0.9)).toContain('emerald');
    expect(rateColor(0.6)).toContain('amber');
    expect(rateColor(0.2)).toContain('red');
  });
});

describe('week helpers', () => {
  it('resolves a Sunday from any day of that week', () => {
    // 2026-08-26 is a Wednesday; its week starts Sunday 2026-08-23.
    expect(sundayOf(new Date('2026-08-26T09:00:00Z'))).toBe('2026-08-23');
    expect(sundayOf(new Date('2026-08-23T09:00:00Z'))).toBe('2026-08-23');
    // Saturday is the last day of the same week, not the first of the next.
    expect(sundayOf(new Date('2026-08-29T21:00:00Z'))).toBe('2026-08-23');
  });

  it('shifts whole weeks in both directions across a month boundary', () => {
    expect(shiftWeek('2026-08-30', 1)).toBe('2026-09-06');
    expect(shiftWeek('2026-09-06', -1)).toBe('2026-08-30');
    expect(shiftWeek('2026-08-23', 0)).toBe('2026-08-23');
  });

  it('renders a Sunday-to-Saturday range', () => {
    const label = fmtWeekRange('2026-08-23', 'en-US');
    expect(label).toContain('23');
    expect(label).toContain('29');
  });
});

describe('initialsOf', () => {
  it('takes up to two initials and falls back for a blank name', () => {
    expect(initialsOf('Dana Levi')).toBe('DL');
    expect(initialsOf('Dana')).toBe('D');
    expect(initialsOf('Dana Levi Cohen')).toBe('DL');
    expect(initialsOf('')).toBe('?');
  });
});
