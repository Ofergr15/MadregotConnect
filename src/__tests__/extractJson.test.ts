import { describe, it, expect } from 'vitest';
import { extractJson } from '../lib/ai/parser';

describe('extractJson — robust JSON extraction from model replies', () => {
  it('plain JSON', () => {
    expect(JSON.parse(extractJson('{"workouts":[]}'))).toEqual({ workouts: [] });
  });
  it('strips ```json fences', () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });
  it('drops a leading sentence before the object', () => {
    expect(JSON.parse(extractJson('Here is the plan:\n{"a":1}'))).toEqual({ a: 1 });
  });
  it('drops trailing prose after the object (brace-matched)', () => {
    expect(JSON.parse(extractJson('{"a":1}\n\nLet me know if you need changes.'))).toEqual({ a: 1 });
  });
  it('handles braces inside string values without stopping early', () => {
    const out = JSON.parse(extractJson('{"notes":"3:20 {rep} (3:30)","b":2} trailing'));
    expect(out).toEqual({ notes: '3:20 {rep} (3:30)', b: 2 });
  });
  it('handles nested objects (repeatSteps-like)', () => {
    const s = '{"workouts":[{"steps":[{"repeatSteps":[{"x":1}]}]}]} done';
    expect(JSON.parse(extractJson(s))).toEqual({ workouts: [{ steps: [{ repeatSteps: [{ x: 1 }] }] }] });
  });
});
