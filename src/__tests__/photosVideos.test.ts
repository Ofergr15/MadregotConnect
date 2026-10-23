import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';

// Videos in the photos module (mockup ~/.cache/madregot/photos-videos.html, Ofer 2026-10-23):
// listed with the photos in one Drive query, a poster until opened, the original streamed
// in ranges behind a signed, expiring link.
beforeAll(() => { process.env.ENCRYPTION_KEY = 'test-key'; });

describe('a video link', () => {
  it('is signed for one file and expires', async () => {
    const { signedVideoUrl, verifyVideoUrl } = await import('@/lib/photos/drive-browse');
    const now = Date.parse('2026-10-23T10:00:00Z');
    const url = new URL(`http://x${signedVideoUrl('1AbCdEfGhIjK', now)!}`);
    const e = Number(url.searchParams.get('e')); const sig = url.searchParams.get('sig')!;
    expect(verifyVideoUrl('1AbCdEfGhIjK', e, sig, now)).toBe(true);
    expect(verifyVideoUrl('1ZzzzzzzzzzZ', e, sig, now)).toBe(false);
    expect(verifyVideoUrl('1AbCdEfGhIjK', e, sig, (e + 1) * 1000)).toBe(false);
  });
});

const read = (p: string) => fs.readFileSync(p, 'utf8');
describe('the listing and the screens', () => {
  it('videos ride on the photos\' own Drive query, and the quality session still sees photos only', () => {
    const lib = read('src/lib/photos/drive-browse.ts');
    expect(lib).toMatch(/mimeType contains 'image\/' or mimeType contains 'video\/'/);
    expect(lib).toMatch(/const folderPhotos = async \(drive: drive_v3\.Drive, folderId: string\) => \(await folderMedia\(drive, folderId, false\)\)\.photos;/);
    expect(lib).toMatch(/photos-library-v4/);
  });
  it('the player loads one video at a time, with sound unless the phone refuses', () => {
    const v = read('src/components/photos/VideoViewer.tsx');
    expect(v).toMatch(/k === cur && x\.src \? \(\s*<video/);
    expect(v).toMatch(/useState\(false\);\n  const \[paused/);
    expect(v).toMatch(/el\.play\(\)\.catch\(\(\) => \{ el\.muted = true; setMuted\(true\)/);
  });
  it('no play mark is the ▶ character (an emoji on iOS)', () => {
    expect(read('src/components/photos/VideoViewer.tsx')).not.toMatch(/>▶</);
    expect(read('src/app/(app)/dashboard/photos/page.tsx')).not.toMatch(/>▶</);
  });
  it('the filter is on the home and in the folder', () => {
    const page = read('src/app/(app)/dashboard/photos/page.tsx');
    expect(page.match(/<MediaSeg /g)?.length).toBe(2);
    expect(page).toMatch(/media === 'videos' \? \(\s*<VideoRows/);
  });
});
