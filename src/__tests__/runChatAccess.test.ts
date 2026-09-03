import { describe, expect, it } from 'vitest';
import { canEditChatPlan } from '@/lib/run-chat/access';

const chat = { athlete_id: 'runner-1' };

describe('canEditChatPlan', () => {
  it('lets staff edit any chat plan', () => {
    expect(canEditChatPlan({ isStaff: true, athleteId: null }, chat)).toBe(true);
  });

  it('lets the runner edit the plan of their own run', () => {
    expect(canEditChatPlan({ isStaff: false, athleteId: 'runner-1' }, chat)).toBe(true);
  });

  it('blocks other runners', () => {
    expect(canEditChatPlan({ isStaff: false, athleteId: 'runner-2' }, chat)).toBe(false);
    expect(canEditChatPlan({ isStaff: false, athleteId: null }, chat)).toBe(false);
  });
});
