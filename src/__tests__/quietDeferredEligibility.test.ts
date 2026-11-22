import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Quiet-hours deferred pain alerts (2026-11-22): the deferral keeps its source context and
 * delivery re-checks eligibility. Synthetic: flag and recipients mocked, no real sends.
 */
const h = vi.hoisted(() => ({ enabled: true, recipients: ['coach-1'] as string[] }));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: vi.fn(async () => h.enabled) }));
vi.mock('@/lib/feedback/pain-server', () => ({ painRecipientIds: vi.fn(async () => ({ ids: h.recipients, isAcademy: false })) }));

const row = (o: Record<string, unknown> = {}) => ({ created_by: 'quiet:pain_report', actor_athlete_id: 'runner-1', audience_id: 'coach-1', ...o });
beforeEach(() => { h.enabled = true; h.recipients = ['coach-1']; });

describe('deferredStillEligible', () => {
  it('eligible at enqueue and at delivery → sent', async () => {
    const { deferredStillEligible } = await import('@/lib/notifications/quiet-deferred');
    expect((await deferredStillEligible({} as any, row())).ok).toBe(true);
  });
  it('enabled at enqueue, DISABLED at delivery → not sent', async () => {
    h.enabled = false;
    const { deferredStillEligible } = await import('@/lib/notifications/quiet-deferred');
    expect(await deferredStillEligible({} as any, row())).toEqual({ ok: false, reason: 'feature_off' });
  });
  it('coach link CHANGED between enqueue and delivery → not sent to the old coach', async () => {
    h.recipients = ['coach-2'];
    const { deferredStillEligible } = await import('@/lib/notifications/quiet-deferred');
    expect(await deferredStillEligible({} as any, row())).toEqual({ ok: false, reason: 'not_a_recipient_now' });
  });
  it('pain_no_checkin is checked the same way', async () => {
    h.enabled = false;
    const { deferredStillEligible } = await import('@/lib/notifications/quiet-deferred');
    expect((await deferredStillEligible({} as any, row({ created_by: 'quiet:pain_no_checkin' }))).ok).toBe(false);
  });
  it('a legacy row without source context fails closed', async () => {
    const { deferredStillEligible } = await import('@/lib/notifications/quiet-deferred');
    expect((await deferredStillEligible({} as any, { created_by: null, actor_athlete_id: null, audience_id: 'coach-1' })).ok).toBe(false);
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('the deferral writes the source kind and the runner', () => {
    const s = read('lib/push.ts');
    expect(s).toMatch(/created_by: `\$\{DEFERRED_SOURCE_PREFIX\}\$\{payload\.kind \?\? ''\}`/);
    expect(s).toMatch(/actor_athlete_id: payload\.actorAthleteId \?\? null/);
    expect(s).toMatch(/actorAthleteId: opts\.actorAthleteId \?\? null/);
  });
  it('cron/notifications re-checks before sending a deferred row', () => {
    const s = read('app/api/cron/notifications/route.ts');
    const i = s.indexOf('if (n.kind === QUIET_DEFERRED_KIND) {');
    expect(s.slice(i, i + 400)).toMatch(/deferredStillEligible\(supabase, n\)/);
  });
});
