import { describe, expect, it } from 'vitest';
import { isWidePath, NARROW_PREFIXES, WIDE_PREFIXES } from '../wide-pages';

describe('isWidePath', () => {
  it.each(WIDE_PREFIXES)('%s is wide', (p) => {
    expect(isWidePath(p)).toBe(true);
    expect(isWidePath(p + '/')).toBe(true);
  });

  it.each(NARROW_PREFIXES)('%s stays narrow', (p) => {
    expect(isWidePath(p)).toBe(false);
  });

  it('covers nested admin screens', () => {
    expect(isWidePath('/dashboard/academy/progress')).toBe(true);
    expect(isWidePath('/dashboard/entry-queue?at=mine')).toBe(true);
  });

  it('does not match by bare string prefix', () => {
    expect(isWidePath('/dashboard/athletes-old')).toBe(false);
    expect(isWidePath('/dashboard/feedbackx')).toBe(false);
  });

  it('keeps everything else narrow', () => {
    for (const p of ['/', '/dashboard', '/dashboard/teammate/1', '/dashboard/settings', null, undefined, '']) {
      expect(isWidePath(p)).toBe(false);
    }
  });
});
