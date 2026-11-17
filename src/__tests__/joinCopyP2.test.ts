import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const join = readFileSync('src/components/join/JoinFlow.tsx', 'utf8');

describe('join flow copy', () => {
  it('#22 step 1 shows "מצטרפים למדרגות" once (title only, no eyebrow)', () => {
    expect(join).toMatch(/hero\('מצטרפים למדרגות 👋', '[^']*', null\)/);
  });
  it('#23 explains why the club name is in English, brands isolated', () => {
    expect(join).toContain('באנגלית, כדי שנזהה אותך ב־<bdi dir="ltr">Strava</bdi> וב־<bdi dir="ltr">Garmin</bdi>');
  });
});
