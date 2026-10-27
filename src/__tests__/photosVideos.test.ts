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
    expect(lib).toMatch(/const LIBRARY_PATH = 'library.json';/);
  });
  it('muted until the member turns the sound on, then it stays on; the videos either side are ready before it lands; the swipe settles first', () => {
    const v = read('src/components/photos/MediaViewer.tsx') + read('src/components/photos/video-slide.tsx');
    expect(v).toMatch(/const \[muted, setMuted\] = useState\(\(\) => \{ try \{ return localStorage\.getItem\(SOUND_KEY\) !== 'on'/);
    expect(v).toMatch(/const mode: SlideMode = k === cur \? 'play' : Math\.abs\(k - cur\) === 1 \? 'ready'/);
    // 'metadata' got an iPhone a neighbour's list and none of its video, and an original's
    // swipe waited ~0.97 s (measured 10-23): every live slide preloads its opening.
    expect(v).toMatch(/preload="auto"/);
    // hls.js: opens at 720p (then climbs), and loads a neighbour itself.
    expect(v).toMatch(/autoStartLoad: false/);
    expect(v).toMatch(/l\.height >= 720/);
    // The picture stays until a frame is painted (it went black for seconds); neighbours never have sound.
    expect(v).toMatch(/requestVideoFrameCallback/);
    expect(v).toMatch(/muted=\{k === cur \? muted : true\}/);
    // No frosted glass over a playing video (redrawn every frame on an iPhone); the bar is its own component.
    expect(v).not.toMatch(/backdrop-blur/);
    expect(v).toMatch(/<Progress key=\{item\.id\}/);
    expect(v).toMatch(/addEventListener\('scrollend', landed\)/);
    expect(v).toMatch(/export const VideoSlide = memo\(/);
  });
  it('one viewer: the session in the order it was shot, a timeline below, the filter on top (mockup א)', () => {
    const page = read('src/app/(app)/dashboard/photos/page.tsx');
    expect(page).not.toMatch(/PhotoViewer|VideoViewer/);
    expect(page).toMatch(/\.sort\(\(a, b\) => \(a\.t \|\| ''\)\.localeCompare\(b\.t \|\| ''\)\)/);
    const v = read('src/components/photos/MediaViewer.tsx');
    expect(v).toMatch(/function Timeline\(/);
    expect(v).toMatch(/\['all', 'הכל'\], \['photos', 'תמונות'\], \['videos', 'סרטונים'\]/);
    // the end of a video stays, like a photo: no going on by itself (Ofer, 10-24)
    expect(v).toMatch(/const onEnded = useCallback\(\(\) => \{ setPaused\(true\); \}, \[\]\);/);
    expect(v).toMatch(/if \(el\.ended\) el\.currentTime = 0;/);
    // a video as wide as it is long on the strip
    expect(v).toMatch(/const thumbW = \(x: MediaItem\) => \(x\.kind === 'video'/);
  });
  it('no play mark is the ▶ character (an emoji on iOS)', () => {
    expect(read('src/components/photos/MediaViewer.tsx')).not.toMatch(/>▶</);
    expect(read('src/components/photos/video-slide.tsx')).not.toMatch(/>▶</);
    expect(read('src/app/(app)/dashboard/photos/page.tsx')).not.toMatch(/>▶</);
  });
  it('the filter is on the home and in the folder', () => {
    const page = read('src/app/(app)/dashboard/photos/page.tsx');
    expect(page.match(/<MediaSeg /g)?.length).toBe(2);
    expect(page).toMatch(/media === 'videos' \? \(\s*<VideoRows/);
  });
});

describe('the listing is built by the cron and stored, never on somebody\'s request (10-23: 21–35 s after every deploy)', () => {
  it('the cron rebuilds and stores it every run; a request reads the stored file; an admin edit re-reads only the folders', () => {
    const cron = read('src/app/api/cron/photos-mirror/route.ts');
    expect(cron).toMatch(/await rebuildLibrary\(\)/);
    expect(cron).not.toMatch(/revalidateTag\('photos-library'/);
    const lib = read('src/lib/photos/drive-browse.ts');
    expect(lib).not.toMatch(/unstable_cache/);
    expect(lib).toMatch(/const stored = await readStoredLibrary\(\)/);
    expect(read('src/lib/photos/folder-meta.ts')).toMatch(/await refreshLibraryFolders\(\)/);
  });
});
