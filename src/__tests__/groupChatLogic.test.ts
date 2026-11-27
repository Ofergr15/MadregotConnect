import { describe, expect, it } from 'vitest';
import {
  cleanClientId, cleanText, GROUP_CHAT_TEXT_MAX, mayDelete, mayEdit, mayEnter, pushRecipients, sortRows, visibleGroupIds, type ChatRow,
} from '@/lib/group-chat/logic';

const runner = { athleteId: 'a', isStaff: false, isSuperUser: false };
const coach = { athleteId: 'c', isStaff: true, isSuperUser: false };

describe('group chat rules', () => {
  it('pushes everyone in the room but the author, once each', () => {
    expect(pushRecipients(['a', 'b', 'b', 'c', ''], 'a')).toEqual(['b', 'c']);
  });
  it('only the author edits; author or staff delete', () => {
    expect(mayEdit(runner, 'a')).toBe(true);
    expect(mayEdit(coach, 'a')).toBe(false);
    expect(mayDelete(coach, 'a')).toBe(true);
    expect(mayDelete(runner, 'b')).toBe(false);
    expect(mayEdit({ ...runner, athleteId: null }, null)).toBe(false);
  });
  it('enters only as a member (or super user); an unknown group lets nobody in', () => {
    expect(mayEnter(runner, ['a'])).toBe(true);
    expect(mayEnter(runner, ['b'])).toBe(false);
    expect(mayEnter({ ...runner, isSuperUser: true }, ['b'])).toBe(true);
    expect(mayEnter({ ...runner, isSuperUser: true }, null)).toBe(false);
  });
  it('a runner lists their own group and led packs; staff list all', () => {
    expect(visibleGroupIds(runner, ['g1', 'g2', 'p'], 'g2', ['p'])).toEqual(['g2', 'p']);
    expect(visibleGroupIds(runner, ['g1'], null, [])).toEqual([]);
    expect(visibleGroupIds(coach, ['g1', 'g2'], null, [])).toEqual(['g1', 'g2']);
  });
  it('validates text and client ids', () => {
    expect(cleanText('  hi ')).toBe('hi');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText('x'.repeat(GROUP_CHAT_TEXT_MAX + 1))).toBeNull();
    expect(cleanClientId('abcDEF12-_')).toBe('abcDEF12-_');
    expect(cleanClientId('short')).toBeNull();
    expect(cleanClientId('has space here')).toBeNull();
  });
  it('sorts newest first, unused chats last by name', () => {
    const r = (groupId: string, lastAt: string | null): ChatRow => ({ groupId, name: groupId, channelId: groupId, lastText: null, lastAuthorId: null, lastAuthorName: null, lastAt, unread: 0, lastReadByOthers: null });
    expect(sortRows([r('b', null), r('x', '2026-11-01T00:00:00Z'), r('a', null), r('y', '2026-11-02T00:00:00Z')]).map((x) => x.groupId))
      .toEqual(['y', 'x', 'a', 'b']);
  });
});
