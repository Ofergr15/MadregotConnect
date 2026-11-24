import { describe, it, expect } from 'vitest';
import { parseNudgeBody, eligibleFromReceipts, eligibleFromPack, nudgeCopy, MAX_NUDGE_BATCH } from '@/lib/academy/read-nudge';
import { FEATURES } from '@/lib/features/flags';
import { readFileSync } from 'node:fs';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const M = '44444444-4444-4444-4444-444444444444';

describe('read nudge (b24 UNR)', () => {
  it('flag exists and is off by default', () => {
    expect(FEATURES.academy_read_nudge.defaultEnabled).toBe(false);
  });

  it('body: needs ids + exactly a context; dedupes; drops non-uuids; caps the batch', () => {
    expect(parseNudgeBody({ athleteIds: [A, A, 'x'], momentId: M })).toEqual({ context: { type: 'moment', momentId: M }, athleteIds: [A] });
    expect(parseNudgeBody({ athleteIds: [A], packId: M })).toEqual({ context: { type: 'pack', packId: M }, athleteIds: [A] });
    expect(parseNudgeBody({ athleteIds: [A] })).toHaveProperty('error');
    expect(parseNudgeBody({ momentId: M })).toHaveProperty('error');
    expect(parseNudgeBody(null)).toHaveProperty('error');
    const many = Array.from({ length: MAX_NUDGE_BATCH + 1 }, (_, i) => `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`);
    expect(parseNudgeBody({ athleteIds: many, momentId: M })).toHaveProperty('error');
  });

  it('moment: only unread receipts of that moment are eligible', () => {
    const rec = [{ athlete_id: A, read_at: null }, { athlete_id: B, read_at: '2026-11-24T08:00:00Z' }];
    expect(eligibleFromReceipts([A, B, C], rec)).toEqual([A]);   // B read it, C never received it
  });

  it('pack: only members not seen since the plan was published; no plan → nobody', () => {
    const members = [{ athleteId: A, lastSeenAt: null }, { athleteId: B, lastSeenAt: '2026-11-23T10:00:00Z' }, { athleteId: C, lastSeenAt: '2026-11-22T10:00:00Z' }];
    expect(eligibleFromPack([A, B, C], members, '2026-11-22T20:00:00Z')).toEqual([A, C]);
    expect(eligibleFromPack([A, B, C], members, null)).toEqual([]);
    expect(eligibleFromPack(['99999999-9999-9999-9999-999999999999'], members, '2026-11-22T20:00:00Z')).toEqual([]);
  });

  it('copy: first name only, falls back to המאמן', () => {
    expect(nudgeCopy('יעל כהן', 'moment').title).toBe('יעל: עוד לא קראת');
    expect(nudgeCopy(null, 'pack').title.startsWith('המאמן:')).toBe(true);
  });

  it('route: identity from the JWT, flag-gated, claims the daily slot before pushing', () => {
    const src = readFileSync('src/app/api/academy/read-nudge/route.ts', 'utf8');
    expect(src).toMatch(/isFeatureEnabled\('academy_read_nudge'/);
    expect(src).not.toMatch(/x-user-email|body\.(coach|email|approver)/);
    expect(src.indexOf("from('read_nudges')")).toBeLessThan(src.indexOf('notifyAthlete({'));
    expect(src).toMatch(/onConflict: 'athlete_id,nudged_on', ignoreDuplicates: true/);
    const mig = readFileSync('supabase/migrations/219_read_nudges.sql', 'utf8');
    expect(mig).toMatch(/PRIMARY KEY \(athlete_id, nudged_on\)/);
    expect(mig).not.toMatch(/REFERENCES/);
  });
});
