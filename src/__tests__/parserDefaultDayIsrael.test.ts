import { describe, expect, it } from 'vitest';
import { splitIntoDays } from '@/lib/ai/parser';

describe('splitIntoDays default day', () => {
  it('uses the Israel weekday, not the UTC one', () => {
    // 2026-11-28 23:30 UTC = Sunday 2026-11-29 01:30 Israel (UTC Saturday).
    const r = splitIntoDays('ריצה קלה 8 ק"מ', new Date('2026-11-28T23:30:00Z'));
    expect(r).toEqual([{ day: 0, content: 'ריצה קלה 8 ק"מ' }]);
  });
});
