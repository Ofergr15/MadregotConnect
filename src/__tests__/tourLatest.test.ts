import { describe, expect, it } from 'vitest';
import { tourLatest } from '@/lib/whats-new/tour-latest';
import { composeWhatsNew } from '@/lib/whats-new/evening';
import { recentEntries } from '@/lib/whats-new/ledger';
import type { WhatsNewRelease } from '@/lib/release-notes';

/**
 * The tour ends on "what's new lately" with no hand-kept list: it must be
 * exactly what the What's new sheet would show — so featuring a release note
 * changes the end of the tour on the next release, and nothing else has to.
 */
const release = (id: number, version: string, day: string, notes: Array<{ id: string; featured: boolean; title: string; audience?: 'staff' }>): WhatsNewRelease => ({
  id, released_at: `${day}T05:00:00Z`, app_version: version,
  notes: notes.map((n) => ({ ...n, date: day, kind: 'feature', icon: '🎉', body: `${n.title} body`, edited: false })),
});

describe('tourLatest', () => {
  it('is the same newest-three the What\'s new sheet composes, for either evening mode', () => {
    const rel = [release(2, '2.41.200', '2099-01-02', [{ id: 'b', featured: true, title: 'Bee' }]), release(1, '2.41.199', '2099-01-01', [{ id: 'a', featured: true, title: 'Ay' }])];
    for (const evening of [true, false]) {
      const expected = recentEntries(composeWhatsNew(rel, '2.41.200', evening).entries).map((e) => e.slug);
      expect(tourLatest(rel, '2.41.200', 'he', evening).map((i) => i.slug)).toEqual(expected);
    }
  });

  it('a newly featured note shows up first, by itself', () => {
    const items = tourLatest([release(9, '2.41.300', '2099-05-05', [{ id: 'fresh', featured: true, title: 'Fresh thing' }])], '2.41.300', 'he', false);
    expect(items[0]).toMatchObject({ slug: 'release:fresh', title: 'Fresh thing', icon: '🎉' });
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it('never shows an unfeatured note, or one newer than the running app', () => {
    const items = tourLatest([
      release(3, '2.41.999', '2099-09-09', [{ id: 'future', featured: true, title: 'Not on this phone yet' }]),
      release(2, '2.41.300', '2099-05-05', [{ id: 'quiet', featured: false, title: 'Not featured' }]),
    ], '2.41.300', 'he', false);
    expect(items.map((i) => i.slug)).not.toContain('release:future');
    expect(items.map((i) => i.slug)).not.toContain('release:quiet');
  });

  it('every item has a title, an icon and somewhere to go', () => {
    for (const i of tourLatest([], '2.41.300')) {
      expect(i.title).toBeTruthy(); expect(i.icon).toBeTruthy(); expect(i.href).toMatch(/^\//);
    }
  });
});

describe('entryIcon: each "what\'s new" tile gets its own icon', () => {
  it('own emoji first, then the drawn screen, then where the row leads; ✨ only as a last resort', async () => {
    const { entryIcon } = await import('@/lib/whats-new/tour-latest');
    expect(entryIcon({ icon: '⭐', art: 'weekShare', href: '/feed' })).toBe('⭐');
    expect(entryIcon({ art: 'weekShare', href: '/dashboard/profile' })).toBe('📅');
    expect(entryIcon({ art: 'nextSession', href: '/dashboard/program' })).toBe('🏃');
    expect(entryIcon({ href: '/dashboard/share?what=run' })).toBe('📸');
    expect(entryIcon({ href: '/dashboard/share?what=week' })).toBe('📅');
    expect(entryIcon({ href: '/somewhere-else' })).toBe('✨');
  });
});
