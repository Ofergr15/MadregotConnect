import { describe, expect, it } from 'vitest';
import { nameOf, nameSuggestions } from '@/lib/plans/plan-names';
import type { ParsedWorkout } from '@/lib/ai/types';

const w = (o: Partial<ParsedWorkout>): ParsedWorkout => ({ dayOfWeek: 5, name: 'ארוכה', steps: [], ...o } as ParsedWorkout);

describe('plan session names (10-23)', () => {
  it('the approved name wins', () => expect(nameOf(w({ workoutName: 'ארוכה 30 · 14 + 7 + 7' }))).toBe('ארוכה 30 · 14 + 7 + 7'));
  it('no steps → the coach name', () => expect(nameOf(w({}))).toBe('ארוכה'));
  it('suggestions never repeat', () => expect(nameSuggestions(w({}))).toEqual(['ארוכה']));
});
