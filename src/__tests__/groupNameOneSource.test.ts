import { describe, expect, it } from 'vitest';
import { groupDisplayName, memberPackName } from '@/lib/utils';

// P1 #8: the header chip, the home "today" pack card and the groups page each
// named the same squad differently ("Group 2" / "Group B - SUB 2:35" / "Group 1").
// They all render through memberPackName now, whatever form the name arrives in:
// the raw DB row (club/today) or the canonical "Group N" from /api/groups.
describe('one display name per squad', () => {
  it.each(['Group B - SUB 2:35', 'Group 2', 'SUB 2:35', 'group b'])('%s → דבוקה 2', (raw) => {
    expect(memberPackName(raw)).toBe('דבוקה 2');
    expect(memberPackName(groupDisplayName(raw))).toBe('דבוקה 2');
  });
  it('keeps an unrecognised club name as written, and empty for none', () => {
    expect(memberPackName('Trail crew')).toBe('Trail crew');
    expect(memberPackName(null)).toBe('');
  });
});
