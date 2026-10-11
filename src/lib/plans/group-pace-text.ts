// The watch text for a step that carries every pack's pace (see lib/plans/watch-paces.ts).
// Kept apart from watch-paces so the Garmin converter can use it without importing the
// plan normalizer.

import type { GroupPace } from '@/lib/ai/types';
import { formatPaceRange } from '@/lib/garmin/pace';

export const samePace = (a: GroupPace | null, b: GroupPace | null) => !!a && !!b && a.min === b.min && a.max === b.max;
const same = samePace;

const fmtRange = (p: GroupPace) => formatPaceRange(p.min, p.max);

/** "4:40-5:15" when all three packs run it the same, "4:15 (4:25) ((4:35))" when they don't. */
export function groupPaceText(paces: [GroupPace, GroupPace, GroupPace]): string {
  const [a, b, c] = paces;
  if (same(a, b) && same(a, c)) return fmtRange(a);
  return `${fmtRange(a)} (${fmtRange(b)}) ((${fmtRange(c)}))`;
}

// A pace token as coaches write it: "4:25", "4:10-4:00", "4:40 – 5:15". The look-arounds
// keep "1:40:00" (a duration) from being read as the pace 1:40.
const PACE_TOKEN = /(?<![\d:])(\d{1,2}):(\d{2})(?:\s*[-–—]\s*(\d{1,2}):(\d{2}))?(?![\d:])/g;

/**
 * The pack's notes with that pack's own pace taken out — the pace is printed from
 * `groupPaces` instead — and whatever else the coach wrote (ג׳ל, הליכה) kept.
 */
export function notesWithoutPace(notes: string | undefined, mine: GroupPace | null): string {
  if (!notes) return '';
  if (!mine) return notes.trim();
  const stripped = notes.replace(PACE_TOKEN, (m, a, b, c, d) => {
    const x = +a * 60 + +b;
    const y = c ? +c * 60 + +d : x;
    const lo = Math.min(x, y), hi = Math.max(x, y);
    return lo === mine.min && hi === (mine.max ?? mine.min) ? '' : m;
  });
  return stripped.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s,·–-]+|[\s,·–-]+$/g, '').trim();
}
