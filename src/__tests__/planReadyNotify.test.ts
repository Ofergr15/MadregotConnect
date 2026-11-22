import { describe, it, expect, vi } from 'vitest';
const sent: any[] = [];
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async (o: any) => { sent.push(o); return {}; }) }));
import { notifyPlanReady } from '@/lib/plan-builder/server';

function db(rows: any[]) {
  return { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) } as any;
}

describe('notify me when the plan is published (plan_ready)', () => {
  it('pushes only members who opted in, on the opt-in category', async () => {
    sent.length = 0;
    const n = await notifyPlanReady(db([
      { id: 'a', notification_prefs: { plan_ready: true } },
      { id: 'b', notification_prefs: {} },
      { id: 'c', notification_prefs: { plan_ready: false } },
      { id: 'd', notification_prefs: null },
    ]), '2026-11-22', ['a', 'b', 'c', 'd']);
    expect(n).toBe(1);
    expect(sent.map((s) => s.athleteId)).toEqual(['a']);
    // category = plan_ready: notifyAthlete's own mute + quiet-hours path applies to it.
    expect(sent[0]).toMatchObject({ kind: 'plan_ready', category: 'plan_ready', url: '/today' });
  });
  it('a first publish calls it; a change does not', async () => {
    const src = (await import('fs')).readFileSync('src/lib/plan-builder/server.ts', 'utf8');
    expect(src).toMatch(/if \(!changes\) await notifyPlanReady\(/);
  });
});
