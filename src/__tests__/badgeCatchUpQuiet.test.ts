import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { BURST_LIMIT, isCatchUp, joinedRecently } from '@/lib/badges/award-engine';

describe('catch-up awards post nothing (#85)', () => {
  const now = new Date('2026-09-23T14:00:00Z');

  it('a member who joined this week is new; last month is not', () => {
    expect(joinedRecently('2026-09-23T13:00:00Z', now)).toBe(true);
    expect(joinedRecently('2026-09-17T15:00:00Z', now)).toBe(true);
    expect(joinedRecently('2026-09-16T13:00:00Z', now)).toBe(false);
    expect(joinedRecently(null, now)).toBe(false);
    expect(joinedRecently('garbage', now)).toBe(false);
  });

  it('a new member is always quiet; an existing one only on a burst', () => {
    expect(isCatchUp(1, true)).toBe(true);
    expect(isCatchUp(1, false)).toBe(false);
    expect(isCatchUp(BURST_LIMIT, false)).toBe(false);
    expect(isCatchUp(BURST_LIMIT + 1, false)).toBe(true);
  });

  it('quiet stops before the feed post and the push, after the award row', () => {
    const src = readFileSync('src/lib/badges/award-engine.ts', 'utf8');
    const body = src.slice(src.indexOf('export async function awardBadge'));
    const quiet = body.indexOf('if (opts.quiet) return true;');
    expect(quiet).toBeGreaterThan(body.indexOf(".from('athlete_badges').insert"));
    expect(quiet).toBeLessThan(body.indexOf(".from('feed_items').insert"));
    expect(quiet).toBeLessThan(body.indexOf('notifyAthlete('));
  });

  it('challenges check the member, not only badges', () => {
    const src = readFileSync('src/lib/challenges/engine.ts', 'utf8');
    expect(src).toMatch(/isNewMember\(supabase, memberId\)/);
    expect(src).toMatch(/awardBadge\(supabase, memberId, badge, context, \{ quiet \}\)/);
  });
});
