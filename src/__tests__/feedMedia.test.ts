import { describe, expect, it } from 'vitest';
import { isAllowedMediaType, extensionForMimeType, isOwnedMediaPath, sanitizeMediaDescriptor, sanitizeMediaList } from '@/lib/feed/media';

describe('isAllowedMediaType', () => {
  it('allows every explicitly supported image type', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(isAllowedMediaType(type)).toBe(true);
    }
  });

  it('rejects a non-image mime type', () => {
    expect(isAllowedMediaType('application/pdf')).toBe(false);
  });

  it('rejects an image type not on the allowlist (e.g. an SVG, which can carry a script payload)', () => {
    expect(isAllowedMediaType('image/svg+xml')).toBe(false);
  });

  it('rejects a spoofed type string with no real image/ prefix', () => {
    expect(isAllowedMediaType('text/image/jpeg')).toBe(false);
  });
});

describe('extensionForMimeType', () => {
  it('maps each known type to its extension', () => {
    expect(extensionForMimeType('image/png')).toBe('png');
    expect(extensionForMimeType('image/webp')).toBe('webp');
    expect(extensionForMimeType('image/heic')).toBe('heic');
    expect(extensionForMimeType('image/heif')).toBe('heic');
  });

  it('falls back to jpg for jpeg and anything unrecognized', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('jpg');
    expect(extensionForMimeType('image/gif')).toBe('jpg');
  });
});

describe('isOwnedMediaPath', () => {
  it('accepts a path correctly namespaced under the athlete id', () => {
    expect(isOwnedMediaPath('athlete-1/photo.jpg', 'athlete-1')).toBe(true);
  });

  it("rejects a path under a DIFFERENT athlete's namespace — the actual security boundary this exists for", () => {
    expect(isOwnedMediaPath('athlete-2/photo.jpg', 'athlete-1')).toBe(false);
  });

  it('rejects a path that merely contains the athlete id, not as a real path prefix', () => {
    expect(isOwnedMediaPath('other/athlete-1-photo.jpg', 'athlete-1')).toBe(false);
  });

  it('rejects a bare filename with no namespace segment at all', () => {
    expect(isOwnedMediaPath('photo.jpg', 'athlete-1')).toBe(false);
  });
});

describe('sanitizeMediaDescriptor', () => {
  it('accepts a valid owned descriptor and preserves numeric dimensions', () => {
    expect(sanitizeMediaDescriptor({ path: 'athlete-1/a.jpg', w: 800, h: 600 }, 'athlete-1')).toEqual({
      path: 'athlete-1/a.jpg', w: 800, h: 600,
    });
  });

  it('nulls out non-numeric or missing dimensions rather than passing them through', () => {
    expect(sanitizeMediaDescriptor({ path: 'athlete-1/a.jpg', w: '800' }, 'athlete-1')).toEqual({
      path: 'athlete-1/a.jpg', w: null, h: null,
    });
  });

  it("rejects a descriptor pointing at another athlete's path", () => {
    expect(sanitizeMediaDescriptor({ path: 'athlete-2/a.jpg' }, 'athlete-1')).toBeNull();
  });

  it('rejects a descriptor with a missing or non-string path', () => {
    expect(sanitizeMediaDescriptor({}, 'athlete-1')).toBeNull();
    expect(sanitizeMediaDescriptor({ path: 123 }, 'athlete-1')).toBeNull();
    expect(sanitizeMediaDescriptor(null, 'athlete-1')).toBeNull();
  });
});

describe('sanitizeMediaList', () => {
  it('keeps only the entries owned by the caller, silently dropping the rest', () => {
    const result = sanitizeMediaList([
      { path: 'athlete-1/a.jpg' },
      { path: 'athlete-2/b.jpg' }, // someone else's — must be dropped, not error
      { path: 'athlete-1/c.jpg' },
    ], 'athlete-1');
    expect(result.map((m) => m.path)).toEqual(['athlete-1/a.jpg', 'athlete-1/c.jpg']);
  });

  it('returns an empty array for an empty input', () => {
    expect(sanitizeMediaList([], 'athlete-1')).toEqual([]);
  });
});
