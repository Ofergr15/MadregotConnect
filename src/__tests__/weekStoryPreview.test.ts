import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { comingSaturday } from '@/lib/week-story/coming-saturday';

describe('the weekly story preview, any day of the week', () => {
  it('is the Saturday the week ends on', () => {
    expect(comingSaturday('2026-10-23')).toBe('2026-10-24'); // Friday
    expect(comingSaturday('2026-10-24')).toBe('2026-10-24'); // Saturday itself
    expect(comingSaturday('2026-10-18')).toBe('2026-10-24'); // Sunday
  });
  it('the feed asks the server for that Saturday when the link carries it', () => {
    const src = readFileSync('src/components/feed/CelebrationStories.tsx', 'utf8');
    expect(src).toMatch(/weekStoryAt/);
    expect(src).toMatch(/\/api\/week-story\?at=\$\{atOk\}/);
  });
});
