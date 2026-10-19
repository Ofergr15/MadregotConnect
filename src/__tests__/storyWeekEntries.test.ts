import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Every way into the week share sheet / week story goes through the stories gate.
 * A source test, like weekSummaryWindow's: a new `kind: 'week'` opener that forgets
 * the gate fails here.
 */
const read = (p: string) => readFileSync(p, 'utf8');

describe('week story entry points are gated', () => {
  it('the only openers of a week share subject are the known, gated ones', () => {
    const hits = execSync(`grep -rl "kind: 'week'" src --include=*.tsx`, { encoding: 'utf8' })
      .trim().split('\n').filter((f) => !f.includes('__tests__')).sort();
    expect(hits).toEqual([
      'src/app/(app)/dashboard/share/page.tsx',
      'src/components/feed/WeekSummaryCard.tsx',
      'src/components/profile/Last7DaysCard.tsx',
      'src/components/profile/MyWeekCard.tsx',
    ]);
  });
  it('the profile cards hide the share button and the sheet unless the gate allows', () => {
    for (const f of ['src/components/profile/Last7DaysCard.tsx', 'src/components/profile/MyWeekCard.tsx']) {
      const s = read(f);
      expect(s).toMatch(/useStoryAccess\('weekly'\)/);
      expect((s.match(/weekStory\?\.allowed/g) || []).length).toBe(2);
    }
  });
  it('the ShareSheet itself refuses a week subject without the gate', () => {
    expect(read('src/components/ShareSheet.tsx')).toMatch(/if \(subject\.kind === 'week' && !weekStory\?\.allowed\) return null;/);
  });
  it('the feed card and the share deep link ask the server gate', () => {
    expect(read('src/components/feed/WeekSummaryCard.tsx')).toMatch(/fetchStoryAccess\('weekly'\)/);
    expect(read('src/app/(app)/dashboard/share/page.tsx')).toMatch(/fetchStoryAccess\('weekly'\)\)\.allowed\) return null/);
  });
  it('WeekShareEditor is mounted only from ShareSheet', () => {
    const hits = execSync(`grep -rl "<WeekShareEditor" src`, { encoding: 'utf8' }).trim().split('\n').filter((f) => !f.includes('__tests__'));
    expect(hits).toEqual(['src/components/ShareSheet.tsx']);
  });
});

describe("What's new: the weekly share headline is gated", async () => {
  const { WHATS_NEW, filterByStoryAccess } = await import('@/lib/whats-new/entries');
  it('is marked as a weekly story entry', () => {
    expect(WHATS_NEW.find((e) => e.slug === 'week-share-2026-09')?.story).toBe('weekly');
  });
  it('is dropped unless the gate says yes', () => {
    const has = (ok: boolean | null) => filterByStoryAccess(WHATS_NEW, ok).some((e) => e.slug === 'week-share-2026-09');
    expect(has(null)).toBe(false);
    expect(has(false)).toBe(false);
    expect(has(true)).toBe(true);
  });
  it('both What-s-new readers filter it', () => {
    expect(read('src/components/whats-new/WhatsNewSheet.tsx')).toMatch(/filterByStoryAccess\(/);
    expect(read('src/components/whats-new/WhatsNewOnboarding.tsx')).toMatch(/filterByStoryAccess\(/);
  });
  it('the profile cards show the tester bar to testers, never when viewed-as', () => {
    for (const f of ['src/components/profile/Last7DaysCard.tsx', 'src/components/profile/MyWeekCard.tsx', 'src/components/feed/WeekSummaryCard.tsx']) {
      expect(read(f)).toMatch(/showTesterBar\(\w+\) && <StoryTesterBar/);
    }
  });
});
