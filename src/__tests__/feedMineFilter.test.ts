import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { MINE_SQUAD, parseSquadParam } from '@/lib/feed/squad-filter';

/**
 * "SEE ONLY MY WORKOUTS" (Sahar, #95) — for everyone since 2026-10-16.
 *
 * A squad kind relative to the caller, like favourites: the route resolves it from
 * the session, so it can only ever narrow the feed down to the caller themselves.
 */

const ROUTE = readFileSync('src/app/api/feed/route.ts', 'utf8');

describe('the "mine" feed filter', () => {
  it('reads "mine", and nothing near it', () => {
    expect(parseSquadParam(MINE_SQUAD)).toEqual({ kind: 'mine' });
    expect(parseSquadParam(' Mine ')).toEqual({ kind: 'mine' });
    for (const near of ['my', 'me', 'mine-only']) expect(parseSquadParam(near)).toBeNull();
  });

  it('is the session\'s athlete, never a query-string id', () => {
    expect(ROUTE).toMatch(/if \(squad\?\.kind === 'mine'\) \{[\s\S]*?squadAuthorIds = \[auth\.user\.athleteId\];/);
  });

  it('is offered to everyone in the club-logo panel', () => {
    const PANEL = readFileSync('src/components/feed/FeedScopeButton.tsx', 'utf8');
    expect(PANEL).toMatch(/const showMine = true;/);
    expect(PANEL).toMatch(/\{showMine && row\('mine', scope\.squad === MINE_SQUAD/);
  });
});
