import { describe, expect, it } from 'vitest';
import { ENTER_MS, LAST_MS, SLIDE_MS, frameAt, videoLength } from '@/components/birthday/video';

/** The year story video's timing: 3s a slide, 4s for the poster, a short slide-in for each but the first. */
describe('year story video timing', () => {
  it('is 3s a slide and 4s for the last', () => {
    expect(videoLength(11)).toBe(10 * SLIDE_MS + LAST_MS);
    expect(videoLength(1)).toBe(LAST_MS);
    expect(videoLength(0)).toBe(0);
  });

  it('opens on the first slide already in', () => {
    expect(frameAt(0, 5)).toEqual({ i: 0, enter: 1, through: 0 });
  });

  it('slides the next one in over ENTER_MS, then holds it', () => {
    expect(frameAt(SLIDE_MS, 5)).toMatchObject({ i: 1, enter: 0 });
    expect(frameAt(SLIDE_MS + ENTER_MS / 2, 5).enter).toBeCloseTo(0.5);
    expect(frameAt(SLIDE_MS + ENTER_MS + 10, 5).enter).toBe(1);
  });

  it('ends on the last slide, never past it', () => {
    expect(frameAt(videoLength(5) + 5000, 5)).toMatchObject({ i: 4, enter: 1, through: 1 });
    expect(frameAt(4 * SLIDE_MS + LAST_MS / 2, 5).through).toBeCloseTo(0.5);
  });
});
