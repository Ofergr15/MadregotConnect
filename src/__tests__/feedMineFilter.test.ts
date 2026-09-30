import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { MINE_SQUAD, parseSquadParam } from '@/lib/feed/squad-filter';

/**
 * "SEE ONLY MY WORKOUTS" (Sahar), for the super user until rollout.
 *
 * A squad kind relative to the caller, like favourites: the route resolves it from
 * the session, so it can only ever narrow the feed down to the caller themselves.
 */

const ROUTE = readFileSync('src/app/api/feed/route.ts', 'utf8');
const PAGE = readFileSync('src/app/(app)/feed/page.tsx', 'utf8');

describe('the "mine" feed filter', () => {
  it('reads "mine", and nothing near it', () => {
    expect(parseSquadParam(MINE_SQUAD)).toEqual({ kind: 'mine' });
    expect(parseSquadParam(' Mine ')).toEqual({ kind: 'mine' });
    for (const near of ['my', 'me', 'mine-only']) expect(parseSquadParam(near)).toBeNull();
  });

  it('is the session\'s athlete, never a query-string id', () => {
    expect(ROUTE).toMatch(/if \(squad\?\.kind === 'mine'\) \{[\s\S]*?squadAuthorIds = \[auth\.user\.athleteId\];/);
  });

  it('is offered to the super user only', () => {
    expect(PAGE).toMatch(/const showMine = useIsSuperUser\(\);/);
    expect(PAGE).toMatch(/\{showMine && \(\s*<SquadChip\s+active=\{squad === MINE_SQUAD\}/);
  });
});
