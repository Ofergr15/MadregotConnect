import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES, TYPE_ORDER } from '@/lib/content/hub';

/** Content › "שיתוף האימון" (Ofer 10-23): the morning's pack cards have their own block, first. */
describe('the share block in Content', () => {
  it('is a kind of its own, first, opening its page', () => {
    expect(TYPE_ORDER[0]).toBe('share');
    expect(CONTENT_TYPES.share.href).toBe('/dashboard/content/share');
  });
});
