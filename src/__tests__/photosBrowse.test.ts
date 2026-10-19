import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signedImageUrl, verifyImageUrl } from '@/lib/photos/drive-browse';
import { captureDay, cleanTitle, dateInName, folderDay, isPinned, isScratchFolder } from '@/lib/photos/folder-names';

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
  // The CDN and the browser cache by URL: a photo's link must stay the same for a
  // while, or every view is a cold trip to Drive (it used to change every hour).
  it('keeps one URL per photo for a six-hour window, and still expires 6–12 h out', () => {
    const t0 = Date.UTC(2026, 9, 19, 6, 0, 1);
    const a = signedImageUrl(ID, 480, t0)!, b = signedImageUrl(ID, 480, t0 + 5.9 * 3600_000)!;
    expect(a).toBe(b);
    const e = Number(parse(a).e) * 1000;
    expect(e - t0).toBeGreaterThanOrEqual(6 * 3600_000);
    expect(e - t0).toBeLessThanOrEqual(12 * 3600_000);
  });
  it('fails closed without a key', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(signedImageUrl(ID, 480)).toBeNull();
    expect(verifyImageUrl(ID, 480, Math.floor(Date.now() / 1000) + 100, 'x'.repeat(32))).toBe(false);
  });
});

// The cases are the club's real folder names (Drive, 2026-10-19).
describe('folder titles', () => {
  it('drops the date and the weekday, so the subline can say the day once', () => {
    expect(cleanTitle('יום שישי 16.10')).toBeNull();
    expect(cleanTitle('25.9 שישי')).toBeNull();
    expect(cleanTitle('יום שלישי 24/3/26')).toBeNull();
    expect(cleanTitle('17.4')).toBeNull();
    expect(cleanTitle('שבת 28.6 2')).toBeNull();
    expect(cleanTitle('יום שישי 22.5.26 - טורבו')).toBe('טורבו');
    expect(cleanTitle('10.6.26 בדיקות לקטט בוולודרום')).toBe('בדיקות לקטט בוולודרום');
    expect(cleanTitle('אימון טמפו ועליות יום שישי 19.6.26')).toBe('אימון טמפו ועליות');
    expect(cleanTitle('יום שבת 29.11 אימון אחרון לולנסיה')).toBe('אימון אחרון לולנסיה');
    expect(cleanTitle('יום צילום כובעים 15.7 3')).toBe('יום צילום כובעים');
  });
  it('keeps what is not a date', () => {
    expect(cleanTitle('מרוץ הסרגל 2026')).toBe('מרוץ הסרגל 2026');
    expect(cleanTitle('מירוץ הרצליה 5K')).toBe('מירוץ הרצליה 5K');
    expect(cleanTitle('יום שלישי 11.8 טסט 3,000')).toBe('טסט 3,000');
    expect(cleanTitle('שלישי עם בנט 29.9')).toBe('שלישי עם בנט');
    expect(cleanTitle('שישי 14.11 מסכמת')).toBe('שישי מסכמת');
  });
});

describe('folder dates', () => {
  it('trusts the camera over a typo in the name', () => {
    // "יום שלישי 10.1.99", photos taken 9.6.2026; "קאמלו 28.2.26", photos taken 28.1.
    expect(folderDay({ name: 'יום שלישי 10.1.99', createdTime: '2026-06-09T08:00:00Z', photoTimes: ['2026:06:09 07:01:00', '2026:06:09 07:20:00'] })).toBe('2026-06-09');
    expect(folderDay({ name: 'קאמלו 28.2.26', createdTime: '2026-01-28T08:00:00Z', photoTimes: ['2026:01:28 07:00:00'] })).toBe('2026-01-28');
  });
  it("uses the name when the photos don't say, not the day the archive was moved", () => {
    expect(folderDay({ name: 'שלישי 3.6', createdTime: '2025-07-20T10:00:00Z', photoTimes: [] })).toBe('2025-06-03');
    expect(dateInName('יום שלישי 10.1.99', '2026-06-09')).toBe('2026-01-10');
    expect(dateInName('מירוץ הרצליה 5K', '2026-09-07')).toBeNull();
  });
  it("prefers the automation's session date", () => {
    expect(folderDay({ name: 'x', tag: '2026-10-17', createdTime: '2026-10-16T17:00:00Z', photoTimes: ['2026:10:16 07:00:00'] })).toBe('2026-10-17');
  });
  it('has no capture day for a mixed folder', () => {
    expect(captureDay(['2019:05:15 10:00:00', '2026:10:13 10:00:00', '2026:10:03 10:00:00'])).toBeNull();
  });
});

describe('which folders show', () => {
  it('hides test folders, pins the race', () => {
    expect(isScratchFolder('Ofer test')).toBe(true);
    expect(isScratchFolder('אדיר בדיקה')).toBe(true);
    expect(isScratchFolder('10.6.26 בדיקות לקטט בוולודרום')).toBe(false);
    expect(isScratchFolder('יום שלישי 11.8 טסט 3,000')).toBe(false);
    expect(isPinned('מרוץ הסרגל 2026')).toBe(true);
  });
});
