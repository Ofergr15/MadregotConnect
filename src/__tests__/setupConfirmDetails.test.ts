import { describe, expect, it } from 'vitest';
import { detailsMode, remainingSteps, type SetupFacts } from '@/lib/setup/gate';
import { importProfileColumns } from '@/lib/academy/import-form';
import { SETUP_GATE_SINCE } from '@/lib/setup/flag';

const full: SetupFacts = { installed: true, phone: true, strava: true, garmin: true, noWatch: false, push: true, birthDate: '1990-03-14', heightCm: 178, sizes: ['44', 'M', 'M', 'S', '43-46'] };

describe('details step: required / confirm / skip', () => {
  it('missing → required', () => {
    expect(detailsMode({ ...full, heightCm: null, detailsConfirmed: false })).toBe('required');
    expect(detailsMode({ ...full, sizes: ['44', 'L', null, null, null], detailsConfirmed: true })).toBe('required');
  });
  it('all prefilled but never confirmed → confirm', () => {
    expect(detailsMode({ ...full, detailsConfirmed: false })).toBe('confirm');
    expect(remainingSteps({ ...full, detailsConfirmed: false })).toEqual(['details']);
  });
  it('confirmed → skip, never asked again', () => {
    expect(detailsMode({ ...full, detailsConfirmed: true })).toBeNull();
    expect(remainingSteps({ ...full, detailsConfirmed: true })).toEqual([]);
  });
  it('unknown confirmation (absent) keeps the old behaviour', () => expect(remainingSteps(full)).toEqual([]));
});

describe('old members', () => {
  it('created before SETUP_GATE_SINCE are outside the gate (route applicable rule)', () => {
    const fresh = (createdAt: string) => createdAt >= SETUP_GATE_SINCE;
    expect(fresh('2026-09-01T10:00:00Z')).toBe(false);
    expect(fresh('2026-11-01T10:00:00Z')).toBe(true);
  });
});

describe('importProfileColumns reads the nested import file', () => {
  const card = {
    imported: { age: 34, city: 'תל אביב', height: 175, weight: 72.5, shoeSize: '44.5', shirtSize: 'L' },
    _import: { coachIds: ['c1'], requestedBandId: 'b1' },
  };
  it('maps intake.imported.* onto the athlete columns', () => {
    expect(importProfileColumns(card)).toEqual({ height_cm: 175, weight_kg: 72.5, shoe_size: '44.5', shirt_size: 'L' });
  });
  it('the trainee form (top level) wins over the file', () => {
    expect(importProfileColumns({ ...card, height: '180', shirtSize: 'M' })).toMatchObject({ height_cm: 180, shirt_size: 'M' });
  });
  it('validates like the top-level mapper: a US shoe size and an odd height are dropped', () => {
    const out = importProfileColumns({ imported: { height: 17, shoeSize: '10.5', shirtSize: 'L' } });
    expect(out).toEqual({ shirt_size: 'L' });
  });
  it('nothing for no intake', () => expect(importProfileColumns(null)).toEqual({}));
});
