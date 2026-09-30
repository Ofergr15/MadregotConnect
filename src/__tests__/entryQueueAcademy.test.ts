import { describe, expect, it } from 'vitest';
import { FLOW_GROUPS, flowGroup, isAcademyApplicant, type EntryQueueMember } from '@/lib/admin/entry-queue';

// An academy applicant is not waiting on the approve button: the academy's calls
// come first and access opens from the academy screen. So never 'mine'.

const member = (over: Partial<EntryQueueMember>): EntryQueueMember => ({
  id: 'x',
  name: 'x',
  email: null,
  groupName: null,
  approved: false,
  approvedAt: null,
  lastSeenAt: null,
  createdAt: null,
  blocked: false,
  hasGarmin: false,
  hasStrava: false,
  hasPush: false,
  setupDone: 0,
  setupTotal: 5,
  stage: 'pending',
  ...over,
});

describe('academy applicants in the entry queue', () => {
  it('puts an unapproved academy signup in its own group, not "mine"', () => {
    expect(flowGroup(member({ academy: true }))).toBe('academy');
    expect(isAcademyApplicant(member({ academy: true }))).toBe(true);
  });
  it('keeps a regular unapproved signup waiting on the club', () => {
    expect(flowGroup(member({}))).toBe('mine');
    expect(flowGroup(member({ academy: false }))).toBe('mine');
  });
  it('treats an admitted academy trainee like any member', () => {
    const m = member({ academy: true, approved: true, stage: 'never' });
    expect(isAcademyApplicant(m)).toBe(false);
    expect(flowGroup(m)).not.toBe('academy');
  });
  it('lists the academy group right after "mine"', () => {
    expect(FLOW_GROUPS.slice(0, 2)).toEqual(['mine', 'academy']);
  });
});
