import { describe, it, expect } from 'vitest';
import { cleanPhotosLink, toSessionPhotos, sessionDayLabel } from '@/lib/quality-session/photos';
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
