import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DATE_HINT, TEST_PREVIEW_NOTE } from '@/lib/u21/intake';

// The /u21 layout wraps every step (track, form, done) and the admin list, so the
// synthetic-data notice can't be skipped by any screen in this preview.
describe('/u21 test-preview notice', () => {
  it('says synthetic details only, no real personal or health details', () => {
    expect(TEST_PREVIEW_NOTE).toContain('בדויים');
    expect(TEST_PREVIEW_NOTE).toContain('אישיים');
    expect(TEST_PREVIEW_NOTE).toContain('רפואיים');
  });
  it('is rendered unconditionally by the /u21 layout', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/u21/layout.tsx'), 'utf8');
    expect(src).toContain('{TEST_PREVIEW_NOTE}');
    expect(src).not.toMatch(/&&\s*\(?\s*<p[^>]*u21-test-preview-notice/);
  });
});

describe('/u21 date hint', () => {
  it('points to the calendar and defers the order to the device, claiming no fixed format', () => {
    expect(DATE_HINT).toContain('לוח השנה');
    expect(DATE_HINT).toContain('הגדרות המכשיר או הדפדפן');
    expect(DATE_HINT).not.toMatch(/\d/);
    expect(DATE_HINT).not.toMatch(/יום\/חודש|חודש\/יום|DD|MM/);
  });
});
