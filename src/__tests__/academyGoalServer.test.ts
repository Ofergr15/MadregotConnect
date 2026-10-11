import { describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * The goal's reads (lib/academy/goal-server.ts, and the trainee home's race line through
 * me-reads.ts): migration 144's own row first, the characterization call as the fallback, and
 * a missing table read as "no stored goal" — never a failed home.
 */

vi.mock('@/lib/stream/server', () => ({ getStreamServerClient: () => { throw new Error('no Stream'); } }));

const { loadGoals, saveGoal } = await import('@/lib/academy/goal-server');
const { loadGoalCharacterization } = await import('@/lib/academy/me-reads');

const SCHEMA = {
  academy_candidates: ['id', 'athlete_id'],
  academy_characterizations: ['candidate_id', 'goal_type', 'target_race', 'target_race_date'],
  academy_goals: ['athlete_id', 'goal_type', 'target_race', 'target_race_date', 'goal_time_sec', 'updated_by', 'updated_at'],
};

function setup(withGoals = true) {
  const schema: Record<string, string[]> = { ...SCHEMA };
  if (!withGoals) delete schema.academy_goals;
  const db = createMemoryDb({ schema, unique: { academy_goals: [['athlete_id']] } });
  const fromCall = uid();
  const own = uid();
  db.tables.academy_candidates.push({ id: 'c1', athlete_id: fromCall }, { id: 'c2', athlete_id: own });
  db.tables.academy_characterizations.push(
    { candidate_id: 'c1', goal_type: 'half', target_race: 'ירושלים', target_race_date: '2027-03-12' },
    { candidate_id: 'c2', goal_type: 'half', target_race: 'old race', target_race_date: '2026-01-01' },
  );
  return { db, fromCall, own };
}

describe('loadGoals', () => {
  it('own row first, the call as the fallback, nothing as none', async () => {
    const { db, fromCall, own } = setup();
    await saveGoal(db.client, own, { goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08', goalTimeSec: 11700 }, 'coach');
    const nobody = uid();
    const { goals, stored } = await loadGoals(db.client, [fromCall, own, nobody]);
    expect(stored).toBe(true);
    expect(goals.get(own)).toMatchObject({ source: 'goals', goal: { targetRace: 'טבריה', goalTimeSec: 11700 } });
    expect(goals.get(fromCall)).toMatchObject({ source: 'characterization', goal: { targetRace: 'ירושלים', goalTimeSec: null } });
    expect(goals.get(nobody)?.source).toBe('none');
  });

  it('before migration 144: reads fall back, a save says tableMissing', async () => {
    const { db, own } = setup(false);
    const { goals, stored } = await loadGoals(db.client, [own]);
    expect(stored).toBe(false);
    expect(goals.get(own)?.source).toBe('characterization');
    expect(await saveGoal(db.client, own, { goalType: 'full', targetRace: null, targetRaceDate: null, goalTimeSec: null }, null))
      .toEqual({ ok: false, tableMissing: true });
  });
});

describe('the home\'s race line (loadGoalCharacterization)', () => {
  it('reads the goal set since the call, so the home and the list agree', async () => {
    const { db, own, fromCall } = setup();
    await saveGoal(db.client, own, { goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08', goalTimeSec: null }, null);
    expect(await loadGoalCharacterization(db.client, own)).toMatchObject({ goalType: 'full', targetRace: 'טבריה', targetRaceDate: '2027-01-08' });
    expect(await loadGoalCharacterization(db.client, fromCall)).toMatchObject({ targetRace: 'ירושלים' });
  });
  it('without migration 144 it is the call\'s answer, as before', async () => {
    const { db, own } = setup(false);
    expect(await loadGoalCharacterization(db.client, own)).toMatchObject({ targetRace: 'old race' });
  });
});
