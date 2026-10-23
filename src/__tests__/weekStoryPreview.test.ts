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

describe('watching one person\'s weekly story from the stories screen', () => {
  it('the person screen links to that person\'s story for the coming Saturday', () => {
    const src = readFileSync('src/components/stories/StoryPerson.tsx', 'utf8');
    expect(src).toMatch(/weekStoryOf=\$\{encodeURIComponent\(athleteId\)\}/);
    expect(src).toMatch(/לצפות בסטורי/);
  });
  it('the feed reads that person\'s week (the server honours it for an admin only)', () => {
    const src = readFileSync('src/components/feed/CelebrationStories.tsx', 'utf8');
    expect(src).toMatch(/weekStoryOf/);
    expect(src).toMatch(/&athleteId=\$\{ofOk\}/);
  });
});
