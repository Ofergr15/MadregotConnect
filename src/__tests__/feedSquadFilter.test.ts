import { describe, it, expect } from 'vitest';
import { parseSquadParam, ACADEMY_SQUAD } from '@/lib/feed/squad-filter';

/**
 * The feed's squad param.
 *
 * Worth its own test because the value is caller-supplied and the interesting
 * behaviour is what an UNEXPECTED value does: degrading to the full feed is a
 * shrug, and degrading to an empty screen is a bug report about the feed being
 * broken. Also: the param is interpolated into a PostgREST filter, so "is this a
 * uuid" is the gate, not a hope.
 */

const GROUP_A = '095cb7bf-136e-4d42-a3b3-e8f0379e5ffb';

describe('parseSquadParam', () => {
  it('reads a group id', () => {
    expect(parseSquadParam(GROUP_A)).toEqual({ kind: 'group', groupId: GROUP_A });
  });

  it('reads the academy, which is a flag and not a group', () => {
    expect(parseSquadParam(ACADEMY_SQUAD)).toEqual({ kind: 'academy' });
    expect(parseSquadParam('Academy')).toEqual({ kind: 'academy' });
  });

  it('treats absent as no filter', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(parseSquadParam(input), String(input)).toBeNull();
    }
  });

  /** A stale bookmark or a typo should show the feed everyone else sees. */
  it('degrades an unrecognised value to the whole club', () => {
    for (const input of ['1', 'group-a', 'squad 2', 'all', 'null', 'undefined']) {
      expect(parseSquadParam(input), input).toBeNull();
    }
  });

  /** The value reaches a PostgREST filter, so a near-uuid is not close enough. */
  it('refuses anything that is not a well-formed uuid', () => {
    for (const input of [
      GROUP_A.slice(0, -1),
      `${GROUP_A}0`,
      GROUP_A.replace('-', ''),
      `${GROUP_A}'`,
      `${GROUP_A},${GROUP_A}`,
      '095cb7bf-136e-4d42-a3b3-e8f0379e5ffz',
    ]) {
      expect(parseSquadParam(input), input).toBeNull();
    }
  });

  it('accepts an uppercase uuid, lowercased', () => {
    expect(parseSquadParam(GROUP_A.toUpperCase())).toEqual({ kind: 'group', groupId: GROUP_A });
  });
});
