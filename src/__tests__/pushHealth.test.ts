import { describe, expect, it } from 'vitest';
import { pushLooksDead, lastReceipt } from '@/lib/push-health';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const dev = (created: string, last: string | null) => ({ created_at: created, last_success_at: last });

describe('pushLooksDead', () => {
  // #108 as prod held it on 2026-10-16: one iOS 18.6 device, last shown 09-29, 38 sent this week.
  it('is true for the one device that stopped showing anything while pushes kept going', () => {
    expect(pushLooksDead([dev('2026-09-19T19:20:44Z', '2026-09-29T04:18:28Z')], 38, NOW)).toBe(true);
  });
  it('is false when any device showed something this week', () => {
    expect(pushLooksDead([dev('2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z'), dev('2026-09-01T00:00:00Z', '2026-10-15T00:00:00Z')], 5, NOW)).toBe(false);
  });
  it('is false for a quiet week — nothing sent, nothing to show', () => {
    expect(pushLooksDead([dev('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z')], 0, NOW)).toBe(false);
  });
  it('is false with no devices (never enabled is another screen) and for a new device', () => {
    expect(pushLooksDead([], 10, NOW)).toBe(false);
    expect(pushLooksDead([dev('2026-10-14T00:00:00Z', null)], 10, NOW)).toBe(false);
  });
  it('reads the newest receipt', () => {
    expect(lastReceipt([dev('x', '2026-09-01T00:00:00Z'), dev('y', '2026-09-29T00:00:00Z'), dev('z', null)])).toBe('2026-09-29T00:00:00Z');
  });
});
