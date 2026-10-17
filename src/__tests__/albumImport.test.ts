import { describe, it, expect } from 'vitest';
import { parseAlbumLink, driveFolderImages, googlePhotosImages, isAllowedHost, IMAGE_HOSTS } from '@/lib/quality-session/album-import';

/**
 * #106 — pulling photos from the album link. The parsing is pinned on the shape of
 * Google's public pages; a real link from Ofer is the end-to-end check.
 */
describe('parseAlbumLink', () => {
  it('reads a Drive folder link in its usual shapes', () => {
    expect(parseAlbumLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toEqual({ kind: 'drive', folderId: '1AbCdEfGhIjKlMnOp' });
    expect(parseAlbumLink('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp')).toEqual({ kind: 'drive', folderId: '1AbCdEfGhIjKlMnOp' });
  });
  it('reads a Google Photos shared album', () => {
    expect(parseAlbumLink('https://photos.app.goo.gl/x8KqZ2abc')).toMatchObject({ kind: 'gphotos' });
    expect(parseAlbumLink('https://photos.google.com/share/AF1Qip')).toMatchObject({ kind: 'gphotos' });
  });
  it('anything else stays a plain link — never fetched', () => {
    expect(parseAlbumLink('https://chat.whatsapp.com/abc')).toBeNull();
    expect(parseAlbumLink('https://evil.example/drive/folders/1AbCdEfGhIjKlMnOp')).toBeNull();
    expect(parseAlbumLink('http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBeNull();
  });
});

describe('driveFolderImages', () => {
  const grid = `
    <div class="flip-entry" id="entry-1aaaaaaaaaaaaaa" tabindex="0"><a href="https://drive.google.com/file/d/1aaaaaaaaaaaaaa/view?usp=drive_web"><div class="flip-entry-title">IMG_0001.JPG</div></a></div>
    <div class="flip-entry" id="entry-1bbbbbbbbbbbbbb" tabindex="0"><a href="#"><div class="flip-entry-title">clip.MOV</div></a></div>
    <div class="flip-entry" id="entry-1cccccccccccccc" tabindex="0"><a href="#"><div class="flip-entry-title">IMG_0002.heic</div></a></div>`;
  it('takes the photos in folder order and skips the videos', () => {
    expect(driveFolderImages(grid)).toEqual([
      'https://lh3.googleusercontent.com/d/1aaaaaaaaaaaaaa=w1600',
      'https://lh3.googleusercontent.com/d/1cccccccccccccc=w1600',
    ]);
  });
});

describe('googlePhotosImages', () => {
  it('one URL per photo, whatever sizes the page repeats it at', () => {
    const a = 'https://lh3.googleusercontent.com/pw/AP1GczOabcdefghijklmnopqrstuvwxyz0123456789';
    const b = 'https://lh3.googleusercontent.com/pw/AP1GczPzyxwvutsrqponmlkjihgfedcba9876543210';
    const html = `"${a}=w200-h300" "${a}=w1200" "${b}=w800" https://lh3.googleusercontent.com/a/ownerAvatar123`;
    expect(googlePhotosImages(html)).toEqual([`${a}=w1600-h1600`, `${b}=w1600-h1600`]);
  });
});

describe('isAllowedHost', () => {
  it('only Google image hosts are ever downloaded', () => {
    expect(isAllowedHost('https://lh3.googleusercontent.com/d/x=w1600', IMAGE_HOSTS)).toBe(true);
    expect(isAllowedHost('https://169.254.169.254/latest/meta-data', IMAGE_HOSTS)).toBe(false);
    expect(isAllowedHost('http://lh3.googleusercontent.com/d/x', IMAGE_HOSTS)).toBe(false);
  });
});
