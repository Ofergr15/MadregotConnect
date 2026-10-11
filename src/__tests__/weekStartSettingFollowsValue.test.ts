import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The profile mounts WeekStartSetting before /api/athletes/me answers, with the
 * MONDAY_WEEK fallback; `useState(value)` kept that first value, so an athlete who
 * had chosen Sunday saw Monday. Checked in WebKit against a page that changes
 * `value` after mount (old: Monday stays pressed; new: Sunday). No
 * @testing-library/react here, so the guard reads the source, as other component
 * tests in this repo do.
 */
const src = readFileSync(new URL('../components/profile/WeekStartSetting.tsx', import.meta.url), 'utf8');

describe('WeekStartSetting', () => {
  it('follows its value prop after mount, except while a save is in flight', () => {
    expect(src).toMatch(/if \(value !== seen && !saving\) \{\s*setSeen\(value\);\s*setDay\(value\);/);
  });
});
