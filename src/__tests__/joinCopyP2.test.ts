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

describe('landing stats band', () => {
  const he = JSON.parse(readFileSync('messages/he.json', 'utf8'));
  const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
  const page = readFileSync('src/app/page.tsx', 'utf8');
  it('#24 says the totals are app-measured, date isolated', () => {
    const find = (o: Record<string, unknown>): string | undefined => {
      for (const v of Object.values(o)) { if (v && typeof v === 'object') { const r = find(v as Record<string, unknown>); if (r) return r; } }
      return (o as Record<string, string>).trackedInAppSince;
    };
    expect(find(he)).toBe('נמדד באפליקציה מאז <d>{date}</d>');
    expect(find(en)).toBe('Tracked in the app since <d>{date}</d>');
    expect(page).toContain("t.rich('trackedInAppSince'");
    expect(page).toContain('<bdi>{c}</bdi>');
  });
});
