import type { Distance } from './pace';

/**
 * What the unified sign-up adds to a club request (signup_requests.intake, migration
 * 158): the best time — marathon first, else half / 10 / 5 — how they came to us, and
 * whether the academy interests them. Cleaned here so the route stores nothing it did
 * not ask for.
 */
export interface Intake {
  bestDistance: Distance | null;
  bestSeconds: number | null;
  race: string | null;
  year: number | null;
  /** No race yet — they were shown the academy. */
  noRace: boolean;
  heardFrom: HeardFrom | null;
  heardWho: string | null;
  academyInterest: boolean;
}

export const HEARD_FROM = ['club-member', 'saw-us', 'race', 'instagram', 'facebook', 'other'] as const;
export type HeardFrom = (typeof HEARD_FROM)[number];
export const HEARD_LABEL: Record<HeardFrom, string> = {
  'club-member': 'חבר/ה במועדון', 'saw-us': 'ראיתי אותנו רצים', race: 'מרוץ', instagram: 'אינסטגרם', facebook: 'פייסבוק', other: 'אחר',
};

const DISTANCES: Distance[] = ['marathon', 'half', '10k', '5k'];
const text = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export function cleanIntake(raw: unknown): Intake | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dist = DISTANCES.includes(r.bestDistance as Distance) ? (r.bestDistance as Distance) : null;
  const secs = typeof r.bestSeconds === 'number' && r.bestSeconds > 600 && r.bestSeconds < 8 * 3600 ? Math.round(r.bestSeconds) : null;
  const year = typeof r.year === 'number' && r.year >= 1990 && r.year <= 2100 ? Math.round(r.year) : null;
  return {
    bestDistance: dist && secs ? dist : null,
    bestSeconds: dist && secs ? secs : null,
    race: text(r.race, 60),
    year,
    noRace: r.noRace === true,
    heardFrom: HEARD_FROM.includes(r.heardFrom as HeardFrom) ? (r.heardFrom as HeardFrom) : null,
    heardWho: text(r.heardWho, 60),
    academyInterest: r.academyInterest === true,
  };
}
