import { describe, it, expect } from 'vitest';
import { siblingGhosts, type SubHealth } from '@/lib/push-ghosts';

const row = (id: string, created: string, last: string | null, athlete = 'a1'): SubHealth =>
  ({ id, athlete_id: athlete, created_at: created, last_success_at: last });

describe('siblingGhosts', () => {
  // The athlete behind feedback #98, as prod held them on 2026-10-11.
  const prod = [
    row('7b309da0', '2026-10-07T06:41:47Z', '2026-10-09T06:38:44Z'),
    row('ce1cc79d', '2026-10-09T18:07:56Z', '2026-10-11T04:04:51Z'),
    row('6c359266', '2026-10-03T05:19:05Z', '2026-10-06T07:45:17Z'),
    row('d459f336', '2026-10-07T06:41:44Z', null),
  ];

  it('finds the endpoint that never showed anything while a sibling did, and the one gone silent', () => {
    // quiet window starts 2026-10-08T04:04 (3 days before the freshest display)
    expect(siblingGhosts(prod).sort()).toEqual(['6c359266', 'd459f336']);
  });

  it('keeps a device that confirmed inside the window, and one too new to judge', () => {
    expect(siblingGhosts(prod)).not.toContain('7b309da0');
    const fresh = [row('live', '2026-10-01T00:00:00Z', '2026-10-11T00:00:00Z'), row('new', '2026-10-09T00:00:00Z', null)];
    expect(siblingGhosts(fresh)).toEqual([]);
  });

  it('does nothing for an athlete with no confirmed display at all', () => {
    expect(siblingGhosts([row('x', '2026-09-01T00:00:00Z', null), row('y', '2026-09-02T00:00:00Z', null)])).toEqual([]);
  });

  it('judges each athlete only by their own devices', () => {
    const rows = [row('a-live', '2026-10-01T00:00:00Z', '2026-10-11T00:00:00Z', 'a'), row('b-only', '2026-09-01T00:00:00Z', null, 'b')];
    expect(siblingGhosts(rows)).toEqual([]);
  });
});
