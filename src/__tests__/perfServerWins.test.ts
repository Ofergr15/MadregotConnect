import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ownGroup } from '@/lib/athletes/own-group';

const route = (p: string) => readFileSync(join(__dirname, '..', 'app', 'api', p), 'utf8');

describe('S1 — athletes/me carries the caller’s own group', () => {
  it('resolves through resolveGroup', () => {
    expect(ownGroup({ group_id: 'g2', groups: { name: 'Group 2 - sub 2:35' } })).toEqual({ id: 'g2', name: 'Group 2 - sub 2:35', index: 2, displayName: 'Group 2', level: 'medium' });
    expect(ownGroup({ group_id: null })).toBeNull();
    expect(ownGroup({ group_id: 'gx', groups: null })!.index).toBeNull();
  });
  it('the route selects the hinted embed and returns `group`', () => {
    const s = route('athletes/me/route.ts');
    expect(s).toMatch(/groups!group_id\(name\)/);
    expect(s).toMatch(/group: ownGroup\(/);
  });
});

describe('S2 — activities?shape=list skips the jsonb columns', () => {
  it('has a list projection without laps/splits/gps', () => {
    const s = route('activities/route.ts');
    const m = s.match(/const listCols = `([^`]*)`/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/laps|splits|gps_points|executed_workout/);
    expect(s).toMatch(/searchParams\.get\('shape'\) === 'list'/);
  });
});
