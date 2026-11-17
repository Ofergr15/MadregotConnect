import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { albumMedia } from '@/lib/search/album-media';
import { memberPackName } from '@/lib/utils';

const t = (k: 'photoCount' | 'videoCount', v: { count: number }) => `${v.count} ${k === 'photoCount' ? 'תמונות' : 'סרטונים'}`;

describe('albumMedia (QA #6)', () => {
  it('a video-only album says its videos, not "0 photos"', () => {
    expect(albumMedia(t, { count: 0, videos: 60 })).toBe('60 סרטונים');
  });
  it('photos, both, and the old payload with no videos field', () => {
    expect(albumMedia(t, { count: 14 })).toBe('14 תמונות');
    expect(albumMedia(t, { count: 2, videos: 3 })).toBe('2 תמונות · 3 סרטונים');
  });
  it('videoCount exists in both locales', () => {
    for (const f of ['messages/he.json', 'messages/en.json']) {
      expect(JSON.parse(readFileSync(f, 'utf8')).search.videoCount).toContain('{count}');
    }
  });
});

describe('pack names in search and the pickers (QA #5)', () => {
  it('the raw DB name reads as the pack', () => {
    expect(memberPackName('Group B - SUB 2:35')).toBe('דבוקה 2');
  });
  const files = [
    'src/app/(app)/dashboard/search/page.tsx',
    'src/components/ViewAsPersonPicker.tsx',
    'src/components/MemberDiscovery.tsx',
  ];
  it.each(files)('%s routes the group name through memberPackName', (f) => {
    const src = readFileSync(f, 'utf8');
    expect(src).toMatch(/memberPackName\(/);
    expect(src).not.toMatch(/\{m\.pack\}|\{start\.packName\}|\[p\.groupName\]|>\{a\.groupName\}</);
  });
});
