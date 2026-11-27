import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { assertSeedTarget, buildSeedClub, PRODUCTION_REFS, seedId } from '@/lib/dev-seed/club';
import { DEV_SUPABASE_REF } from '@/lib/dev-api-allowlist';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

describe('assertSeedTarget — never production', () => {
  it.each(PRODUCTION_REFS)('refuses production ref %s, even when allow-listed', (ref) => {
    expect(() => assertSeedTarget(`https://${ref}.supabase.co`)).toThrow(/PRODUCTION/);
    expect(() => assertSeedTarget(`https://${ref}.supabase.co`, { SEED_DEV_ALLOW_REF: ref })).toThrow(/PRODUCTION/);
  });
  it('refuses an unknown project (allow-list, not deny-list), a missing URL and VERCEL_ENV=production', () => {
    expect(() => assertSeedTarget('https://abcdefghijklmnopqrst.supabase.co')).toThrow(/not the dev project/);
    expect(() => assertSeedTarget(undefined)).toThrow(/missing/);
    expect(() => assertSeedTarget(`https://${DEV_SUPABASE_REF}.supabase.co`, { VERCEL_ENV: 'production' })).toThrow(/production/);
  });
  it('accepts the dev project, localhost, and an explicitly allowed sandbox', () => {
    expect(assertSeedTarget(`https://${DEV_SUPABASE_REF}.supabase.co`)).toBe(DEV_SUPABASE_REF);
    expect(assertSeedTarget('http://127.0.0.1:54321')).toBe('127.0.0.1');
    expect(assertSeedTarget('https://sandboxref.supabase.co', { SEED_DEV_ALLOW_REF: 'sandboxref' })).toBe('sandboxref');
  });
  it('the script never reads .env.local or NEXT_PUBLIC_SUPABASE_URL', () => {
    const src = readFileSync('scripts/seed-dev.mts', 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/loadEnvFile|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/assertSeedTarget\(/);
  });
});

describe('buildSeedClub', () => {
  const club = buildSeedClub({ anchor: '2026-11-28' });

  it('is deterministic', () => {
    expect(buildSeedClub({ anchor: '2026-11-28' })).toEqual(club);
    expect(seedId('x')).toBe(seedId('x'));
    expect(seedId('x')).not.toBe(seedId('y'));
  });

  it('is sized like the real club with undeliverable emails and Latin names', () => {
    expect(club.groups).toHaveLength(3);
    expect(club.athletes).toHaveLength(27);
    for (const a of club.athletes) {
      expect(a.email).toMatch(/@example\.test$/);
      expect(a.name).toMatch(/^[A-Za-z ]+$/);
      expect(a.id).toMatch(UUID);
    }
    expect(new Set(club.athletes.map((a) => a.email)).size).toBe(27);
    expect(club.athlete_activities.length).toBeGreaterThan(25 * 8 * 4 - 25 * 6);
  });

  it('runs are qualifying, unique, never after the anchor, wall-clock stamped', () => {
    const acts = club.athlete_activities as Array<{ id: string; start_time: string; distance: number; duration: number; activity_type: string; athlete_id: string; garmin_activity_id: number }>;
    expect(filterQualifyingRuns(acts)).toHaveLength(acts.length);
    expect(new Set(acts.map((a) => a.id)).size).toBe(acts.length);
    expect(new Set(acts.map((a) => `${a.athlete_id}:${a.garmin_activity_id}`)).size).toBe(acts.length);
    expect(acts.every((a) => a.start_time.slice(0, 10) <= '2026-11-28')).toBe(true);
    expect(acts.every((a) => /T0[5-7]:\d\d:00\+00:00$/.test(a.start_time))).toBe(true);
    // Staff have no runs and no group.
    const staff = club.athletes.slice(25).map((a) => a.id);
    expect(acts.some((a) => staff.includes(a.athlete_id))).toBe(false);
  });

  it('starts on a Monday week (activity week)', () => {
    const first = (club.athlete_activities as Array<{ start_time: string }>).map((a) => a.start_time).sort()[0];
    expect(first.slice(0, 10) >= '2026-10-05').toBe(true); // Monday 8 weeks back from the week of 2026-11-23
  });
});
