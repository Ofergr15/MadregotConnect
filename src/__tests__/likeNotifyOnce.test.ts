import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Like → unlike → like used to notify the author every time: a fresh history row
 * and +1 on the badge for the same teammate on the same run.
 */

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, sent: 0 }));

vi.mock('@/lib/push', () => ({
  notifyAthlete: async (n: { athleteId: string; kind: string; actorAthleteId: string; url: string }) => {
    h.sent++;
    h.rows.push({ audience_type: 'athlete', audience_id: n.athleteId, actor_athlete_id: n.actorAthleteId, url: n.url, kind: n.kind });
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const f: Array<(r: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; };
      q.in = (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; };
      q.limit = async () => ({ data: h.rows.filter((r) => f.every((x) => x(r))), error: null });
      return q;
    },
  }),
}));

import { notifyFeedInteraction } from '@/lib/feed/notify';

const like = (actor: string, item = 'item-1') => notifyFeedInteraction({
  feedItemId: item, authorAthleteId: 'author', actorAthleteId: actor, actorName: actor, kind: 'like', itemType: 'activity',
});

describe('like notifications', () => {
  beforeEach(() => { h.rows = []; h.sent = 0; });

  it('tells the author once per teammate per run, however often they re-like', async () => {
    await like('dana');
    await like('dana');
    await like('dana');
    expect(h.sent).toBe(1);
  });

  it('still tells them about a different teammate, or a different run', async () => {
    await like('dana');
    await like('omer');
    await like('dana', 'item-2');
    expect(h.sent).toBe(3);
  });

  it('comments are never deduplicated', async () => {
    for (let i = 0; i < 2; i++) {
      await notifyFeedInteraction({ feedItemId: 'item-1', authorAthleteId: 'author', actorAthleteId: 'dana', actorName: 'dana', kind: 'comment', commentBody: `hi ${i}` });
    }
    expect(h.sent).toBe(2);
  });
});
