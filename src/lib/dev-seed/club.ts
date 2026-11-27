/**
 * A realistic FAKE club for a dev/sandbox Supabase project — pure and deterministic, so the same
 * seed gives the same rows every run and re-seeding is an idempotent upsert on fixed ids.
 *
 * Nothing here touches a network. `scripts/seed-dev.mts` writes it, and only after
 * `assertSeedTarget` has refused every production project (see guard below).
 *
 * Shape (sized like the real club, CLAUDE.md "the 25-athlete roster"): 1 coach, 3 pace groups,
 * 25 runners + 2 staff, 8 weeks of runs ending on the anchor date (4–6 runs/week each, Monday
 * activity weeks), a mix of Garmin and Strava sources. All emails are @example.test (RFC 2606 —
 * cannot be delivered), all names are invented Latin names (athletes.name is Latin-only, CLAUDE.md).
 */
import { COACH_ID } from '@/lib/constants';
import { DEV_SUPABASE_REF } from '@/lib/dev-api-allowlist';

export interface SeedClub {
  coaches: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  athletes: Array<Record<string, unknown>>;
  athlete_activities: Array<Record<string, unknown>>;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable UUID-shaped id from a label, so re-seeding upserts the same rows. */
export function seedId(label: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519);
    h3 = Math.imul(h3 ^ c, 3266489917); h4 = Math.imul(h4 ^ c, 668265263);
  }
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  // version 4 / variant 8 nibbles so it validates as a UUID everywhere.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const FIRST = ['Noa', 'Yael', 'Omer', 'Itai', 'Maya', 'Dana', 'Lior', 'Tamar', 'Eden', 'Roni', 'Gal', 'Shira', 'Yonatan',
  'Adi', 'Neta', 'Ido', 'Michal', 'Amit', 'Hila', 'Tomer', 'Keren', 'Nadav', 'Yarden', 'Ori', 'Inbar', 'Alon', 'Rotem'];
const LAST = ['Levin', 'Shaked', 'Barak', 'Golan', 'Peretz', 'Avni', 'Carmel', 'Doron', 'Erez', 'Friedman'];

export const SEED_GROUPS = [
  { key: 'a', name: 'Group A', pace: 285 },
  { key: 'b', name: 'Group B', pace: 320 },
  { key: 'c', name: 'Group C', pace: 360 },
] as const;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function buildSeedClub(opts: { anchor: string; weeks?: number; runners?: number; seed?: number } = { anchor: '2026-11-28' }): SeedClub {
  const weeks = opts.weeks ?? 8;
  const runners = opts.runners ?? 25;
  const rand = rng(opts.seed ?? 42);
  const coachEmail = 'coach@example.test';

  const coaches = [{ id: COACH_ID, email: coachEmail, name: 'Dev Coach' }];
  const groups = SEED_GROUPS.map((g) => ({ id: seedId(`group:${g.key}`), coach_id: COACH_ID, name: g.name }));

  const athletes: SeedClub['athletes'] = [];
  for (let i = 0; i < runners + 2; i++) {
    const staff = i >= runners;
    const g = SEED_GROUPS[i % SEED_GROUPS.length];
    athletes.push({
      id: seedId(`athlete:${i}`),
      coach_id: COACH_ID,
      group_id: staff ? null : seedId(`group:${g.key}`),
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      email: staff ? `staff${i - runners + 1}@example.test` : `runner${i + 1}@example.test`,
      status: 'active',
    });
  }

  // Runs: the `weeks` Monday-weeks ending with the anchor's week, wall-clock start_time stored
  // UTC-shaped (CLAUDE.md: "Activity timestamps are UTC-shaped, not UTC").
  const anchor = new Date(`${opts.anchor}T12:00:00Z`);
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  const first = new Date(monday);
  first.setUTCDate(monday.getUTCDate() - (weeks - 1) * 7);

  const athlete_activities: SeedClub['athlete_activities'] = [];
  let garminSeq = 9_000_000_000;
  athletes.slice(0, runners).forEach((a, i) => {
    const pace = SEED_GROUPS[i % SEED_GROUPS.length].pace + Math.round((rand() - 0.5) * 30);
    const strava = i % 5 === 4;
    for (let w = 0; w < weeks; w++) {
      const runsThisWeek = 4 + Math.floor(rand() * 3);
      const days = [0, 1, 2, 3, 4, 5, 6].sort(() => rand() - 0.5).slice(0, runsThisWeek).sort();
      for (const day of days) {
        const d = new Date(first);
        d.setUTCDate(first.getUTCDate() + w * 7 + day);
        if (isoDate(d) > opts.anchor) continue;
        const longRun = day === 5;
        const km = longRun ? 14 + rand() * 10 : 5 + rand() * 7;
        const meters = Math.round(km * 1000);
        const runPace = pace + Math.round((rand() - 0.3) * 25) + (longRun ? 15 : 0);
        const hour = 5 + Math.floor(rand() * 3);
        const startTime = `${isoDate(d)}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00+00:00`;
        const id = seedId(`act:${i}:${w}:${day}`);
        garminSeq += 1;
        athlete_activities.push({
          id,
          athlete_id: a.id,
          garmin_activity_id: strava ? -garminSeq : garminSeq,
          ...(strava ? { strava_activity_id: garminSeq, source: 'strava' } : { source: 'garmin' }),
          activity_name: longRun ? 'Long run' : 'Morning run',
          activity_type: 'running',
          start_time: startTime,
          distance: meters,
          duration: Math.round((meters / 1000) * runPace),
          average_pace: runPace,
          average_hr: 135 + Math.round(rand() * 30),
          elevation_gain: Math.round(rand() * 80),
        });
      }
    }
  });

  return { coaches, groups, athletes, athlete_activities };
}

/**
 * Production refs this script must never write to: the current EU project and the old Tokyo one
 * (supabase/ops/eu-move/RUNBOOK.md).
 */
export const PRODUCTION_REFS = ['zrrklhonqtzycayjdbor', 'njzldypndkicpsmdtyll'] as const;

/**
 * Throws unless `url` is the dev project or a local Supabase. Allow-list, not deny-list: an
 * unknown project is refused too, so a new production project can't slip through. A second
 * sandbox can be allowed explicitly with SEED_DEV_ALLOW_REF — never a production ref.
 */
export function assertSeedTarget(url: string | undefined, env: Record<string, string | undefined> = {}): string {
  if (env.VERCEL_ENV === 'production') throw new Error('seed-dev: refusing to run with VERCEL_ENV=production');
  let host: string;
  try { host = new URL(url ?? '').hostname; } catch { throw new Error('seed-dev: SEED_SUPABASE_URL is missing or not a URL'); }
  if (host === 'localhost' || host === '127.0.0.1') return host;
  const ref = host.split('.')[0];
  if ((PRODUCTION_REFS as readonly string[]).includes(ref)) throw new Error(`seed-dev: ${ref} is PRODUCTION — refusing`);
  const extra = (env.SEED_DEV_ALLOW_REF || '').trim();
  if (ref === DEV_SUPABASE_REF || (extra && ref === extra)) return ref;
  throw new Error(`seed-dev: ${ref} is not the dev project (${DEV_SUPABASE_REF}) — refusing. Set SEED_DEV_ALLOW_REF=${ref} if it is a sandbox.`);
}
