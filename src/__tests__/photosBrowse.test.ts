import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderDate, signedImageUrl, verifyImageUrl } from '@/lib/photos/drive-browse';

const ID = 'AbCdEfGhIjKlMnOp1234';
let saved: string | undefined;
beforeEach(() => { saved = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = 'test-key-for-photos'; });
afterEach(() => { process.env.ENCRYPTION_KEY = saved; });

const parse = (url: string) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('signed photo URLs', () => {
  it('verifies the file and size it was signed for', () => {
    const q = parse(signedImageUrl(ID, 480)!);
    expect(verifyImageUrl(ID, 480, Number(q.e), q.sig)).toBe(true);
  });
  it('cannot be widened to another file or another size', () => {
    const q = parse(signedImageUrl(ID, 480)!);
    expect(verifyImageUrl('ZzZzZzZzZzZzZzZz9999', 480, Number(q.e), q.sig)).toBe(false);
    expect(verifyImageUrl(ID, 1600, Number(q.e), q.sig)).toBe(false);
  });
  it('expires', () => {
    const q = parse(signedImageUrl(ID, 480, Date.now() - 1000 * 60 * 60 * 24)!);
    expect(verifyImageUrl(ID, 480, Number(q.e), q.sig)).toBe(false);
  });
  it('fails closed without a key', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(signedImageUrl(ID, 480)).toBeNull();
    expect(verifyImageUrl(ID, 480, Math.floor(Date.now() / 1000) + 100, 'x'.repeat(32))).toBe(false);
  });
});

describe('folderDate', () => {
  it("prefers the automation's session date over when the folder was made", () => {
    expect(folderDate({ createdTime: '2026-10-16T17:00:00Z', appProperties: { madregotSessionDate: '2026-10-17' } })).toBe('2026-10-17');
    expect(folderDate({ createdTime: '2026-09-25T06:00:00Z' })).toBe('2026-09-25');
  });
});
