import { describe, expect, it } from 'vitest';
import { matchAthleteByName, matchAthleteByNameKey, matchRealRowByName } from '@/lib/auth/athlete-identity';

/**
 * Chen Becher, 2026-10-20: approved (still `invited`), roster name a placeholder, signs
 * in with Strava from the landing page. None of the old matches found him.
 */
const real = { id: 'A', name: 'Chenbecher92', email: 'chenbecher92@gmail.com', status: 'invited', approved: true };
const shell = { id: 'B', name: 'Chen Becher', email: 'strava_161275981@strava.madregot.local', status: 'invited', approved: false };
const typed = new Map([['A', ['Chen becher']]]);

describe('a Strava sign-in finds the approved member who has not come in yet', () => {
  it('the old matches miss him', () => {
    expect(matchAthleteByName([real], 'Chen Becher')).toBeNull();
    expect(matchAthleteByNameKey([real], 'Chen Becher')).toBeNull();
  });
  it('the name typed on sign-up finds the real row, any status', () => {
    expect(matchRealRowByName([real, shell], 'Chen Becher', typed)?.id).toBe('A');
  });
  it('the roster name itself, once it is right', () => {
    expect(matchRealRowByName([{ ...real, name: 'Chen Becher' }, shell], 'Chen Becher')?.id).toBe('A');
  });
  it('never a synthetic shell, never a removed row, never a guess between two', () => {
    expect(matchRealRowByName([shell], 'Chen Becher')).toBeNull();
    expect(matchRealRowByName([{ ...real, name: 'Chen Becher', status: 'removed' }], 'Chen Becher')).toBeNull();
    expect(matchRealRowByName([{ ...real, name: 'Chen Becher' }, { ...real, id: 'C', email: 'x@y.z', name: 'Chen Becher' }], 'Chen Becher')).toBeNull();
  });
});
