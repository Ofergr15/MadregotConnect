import { describe, expect, it } from 'vitest';
import { watchSentCopy } from '@/lib/notifications/watch-push-copy';
import type { ParsedWorkout } from '@/lib/ai/types';

const sunday = { dayOfWeek: 0, name: 'יום ראשון', distanceMinKm: 16, distanceMaxKm: 16, steps: [] } as unknown as ParsedWorkout;

describe('watchSentCopy — a re-send says it replaced something', () => {
  it('first send: unchanged wording', () => {
    expect(watchSentCopy('he', [sunday]).title).toBe('⌚ אימון יום ראשון נשלח לשעון');
  });
  it('re-send: "updated", and tells them to sync', () => {
    const c = watchSentCopy('he', [sunday], { updated: true });
    expect(c.title).toBe('⟳ אימון יום ראשון עודכן');
    expect(c.body.startsWith('פותחים את Garmin Connect')).toBe(true);
  });
  it('english', () => {
    expect(watchSentCopy('en', [sunday], { updated: true }).title).toMatch(/updated/);
  });
});
