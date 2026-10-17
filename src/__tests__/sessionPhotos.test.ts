import { describe, it, expect } from 'vitest';
import { cleanPhotosLink, toSessionPhotos, sessionDayLabel, sessionSubline } from '@/lib/quality-session/photos';
import { sessionPhotosCopy } from '@/lib/notifications/copy';

/** #106 — the quality session's photos card (mockup feed-photos-106/mockup-v2.html). */
describe('cleanPhotosLink', () => {
  it('takes any http(s) album link', () => {
    expect(cleanPhotosLink(' https://photos.app.goo.gl/x8KqZ2 ')).toBe('https://photos.app.goo.gl/x8KqZ2');
    expect(cleanPhotosLink('https://drive.google.com/drive/folders/abc')).toBe('https://drive.google.com/drive/folders/abc');
  });
  it('never makes a script or a data URL into the card\'s button', () => {
    expect(cleanPhotosLink('javascript:alert(1)')).toBeNull();
    expect(cleanPhotosLink('data:text/html,hi')).toBeNull();
    expect(cleanPhotosLink('not a link')).toBeNull();
    expect(cleanPhotosLink(42)).toBeNull();
  });
});

describe('toSessionPhotos', () => {
  const ok = { kind: 'session_photos', date: '2026-10-13', workoutName: 'עליות', link: 'https://x.co/a', byAthleteId: 'a1' };
  it('reads a session-photos announcement', () => {
    expect(toSessionPhotos(ok)).toMatchObject({ date: '2026-10-13', link: 'https://x.co/a', workoutName: 'עליות' });
  });
  it('leaves every other announcement to the plain post card', () => {
    expect(toSessionPhotos({ notificationId: 'n1' })).toBeNull();
    expect(toSessionPhotos(null)).toBeNull();
  });
  it('a stored row with a bad link renders as a plain post, not a broken button', () => {
    expect(toSessionPhotos({ ...ok, link: 'javascript:x' })).toBeNull();
  });
});

describe('sessionDayLabel / copy', () => {
  it('names the day the way the feed does', () => {
    expect(sessionDayLabel('2026-10-13')).toBe('שלישי 13.10');
  });
  it('the push names the workout when there is one', () => {
    expect(sessionPhotosCopy('he', { workout: 'עליות' })).toEqual({ title: '📸 התמונות מאימון הבוקר עלו', body: 'עליות · לחיצה פותחת את כל התמונות' });
  });
});

describe('at the top of the feed (Ofer, 2026-10-17)', () => {
  it('the feed pins the newest session photos for two days and keeps it out of the list meanwhile', async () => {
    const { readFileSync } = await import('fs');
    const page = readFileSync('src/app/(app)/feed/page.tsx', 'utf8');
    expect(page).toMatch(/useApi<\{ id: string \| null \}>\('\/api\/feed\/session-photos'\)/);
    expect(page).toMatch(/item\.id !== focusItem\?\.id && item\.id !== photosItem\?\.id/);
    const { SESSION_PHOTOS_TOP_HOURS } = await import('@/lib/quality-session/photos');
    expect(SESSION_PHOTOS_TOP_HOURS).toBe(48);
  });
});

describe('sessionSubline', () => {
  it('does not say the weekday twice', () => {
    expect(sessionSubline('2026-10-13', 'שלישי - בוקר')).toBe('שלישי 13.10');
    expect(sessionSubline('2026-10-13', 'עליות')).toBe('שלישי 13.10 · עליות');
    expect(sessionSubline('2026-10-13', null)).toBe('שלישי 13.10');
  });
});
