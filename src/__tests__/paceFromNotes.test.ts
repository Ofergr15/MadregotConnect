import { describe, it, expect } from 'vitest';
import { paceFromNotes } from '../lib/ai/parser';

describe('paceFromNotes — notes are the source of truth for pace', () => {
  it('single pace: "4:40"', () => {
    expect(paceFromNotes('4:40')).toEqual({ min: 280, max: 280 });
  });
  it('the reported bug: "4:40 – 5:30" (en-dash)', () => {
    expect(paceFromNotes('4:40 – 5:30')).toEqual({ min: 280, max: 330 });
  });
  it('hyphen range: "4:30-5:30"', () => {
    expect(paceFromNotes('4:30-5:30')).toEqual({ min: 270, max: 330 });
  });
  it('recovery written high-to-low normalizes to fast-first: "4:10-4:00"', () => {
    expect(paceFromNotes('4:10-4:00')).toEqual({ min: 240, max: 250 });
  });
  it('only reads the Group ❶ segment before brackets', () => {
    expect(paceFromNotes('3:50 (4:00) ((4:10))')).toEqual({ min: 230, max: 230 });
  });
  it('bracket range: "4:00-4:10 (4:10-4:20) ((4:20-4:30))"', () => {
    expect(paceFromNotes('4:00-4:10 (4:10-4:20) ((4:20-4:30))')).toEqual({ min: 240, max: 250 });
  });
  it('no pace in notes -> null (walk / effort / all-out)', () => {
    expect(paceFromNotes('הליכה')).toBeNull();
    expect(paceFromNotes('All out')).toBeNull();
    expect(paceFromNotes('מתגברת')).toBeNull();
    expect(paceFromNotes(undefined)).toBeNull();
  });
});
