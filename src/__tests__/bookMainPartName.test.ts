import { describe, expect, it } from 'vitest';
import { fromLibrarySteps, structureName, bookTotals } from '@/lib/academy/book-steps';
import type { LibraryStep } from '@/lib/academy/library';

/**
 * Book titles name the MAIN part (Ofer, 2026-10-20): the real sessions the importer found in
 * the club's plans. Strides on a run are said after the run, not as the session.
 */
const REAL: Record<string, LibraryStep[]> = {
 "15 × 200 מ׳": [
  {
   "type": "warmup",
   "order": 1,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 3000,
   "intensity": {
    "fastPct": 82.1,
    "slowPct": 73
   },
   "targetZone": "easy"
  },
  {
   "type": "interval",
   "order": 2,
   "targetType": "pace",
   "repeatCount": 15,
   "durationType": "distance",
   "durationValue": 200,
   "repeatSteps": [
    {
     "type": "interval",
     "targetType": "pace",
     "durationType": "distance",
     "durationValue": 200,
     "intensity": {
      "fastPct": 119.4,
      "slowPct": 116.4
     },
     "targetZone": "sprint"
    },
    {
     "type": "rest",
     "targetType": "no_target",
     "durationType": "distance",
     "durationValue": 100,
     "notes": "הליכה"
    }
   ]
  }
 ],
 "6 × 20 שנ׳": [
  {
   "type": "warmup",
   "order": 1,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 2400,
   "intensity": {
    "fastPct": 79.3,
    "slowPct": 69.7
   },
   "targetZone": "easy"
  },
  {
   "type": "interval",
   "order": 2,
   "targetType": "no_target",
   "repeatCount": 6,
   "durationType": "time",
   "durationValue": 20,
   "notes": "מתגברת",
   "repeatSteps": [
    {
     "type": "interval",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 20,
     "notes": "מתגברת"
    },
    {
     "type": "recovery",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 40,
     "notes": "ג׳וג"
    }
   ]
  }
 ],
 "2 × 20 שנ׳": [
  {
   "type": "warmup",
   "order": 1,
   "targetType": "pace",
   "durationType": "distance",
   "durationValue": 2000,
   "intensity": {
    "fastPct": 83.6,
    "slowPct": 80.6
   },
   "targetZone": "easy"
  },
  {
   "type": "rest",
   "order": 2,
   "targetType": "no_target",
   "durationType": "time",
   "durationValue": 120,
   "notes": "הליכה"
  },
  {
   "type": "interval",
   "order": 3,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 45,
   "intensity": {
    "fastPct": 101.5,
    "slowPct": 98.5
   },
   "targetZone": "threshold"
  },
  {
   "type": "interval",
   "order": 4,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 45,
   "intensity": {
    "fastPct": 106,
    "slowPct": 103
   },
   "targetZone": "interval"
  },
  {
   "type": "interval",
   "order": 5,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 45,
   "intensity": {
    "fastPct": 111,
    "slowPct": 108
   },
   "targetZone": "interval"
  },
  {
   "type": "interval",
   "order": 6,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 45,
   "intensity": {
    "fastPct": 116.5,
    "slowPct": 113.5
   },
   "targetZone": "sprint"
  },
  {
   "type": "rest",
   "order": 7,
   "targetType": "no_target",
   "durationType": "time",
   "durationValue": 120,
   "notes": "הליכה"
  },
  {
   "type": "interval",
   "order": 8,
   "targetType": "no_target",
   "repeatCount": 2,
   "durationType": "time",
   "durationValue": null,
   "repeatSteps": [
    {
     "type": "interval",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 20,
     "notes": "מתגברת"
    },
    {
     "type": "rest",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 40,
     "notes": "הליכה"
    }
   ]
  },
  {
   "type": "active",
   "order": 9,
   "targetType": "pace",
   "durationType": "distance",
   "durationValue": 15000,
   "intensity": {
    "fastPct": 109.5,
    "slowPct": 108.5
   },
   "targetZone": "interval"
  },
  {
   "type": "active",
   "order": 10,
   "targetType": "no_target",
   "durationType": "distance",
   "durationValue": 6100,
   "notes": "מתפתח חזק"
  }
 ],
 "5 × 20 שנ׳": [
  {
   "type": "active",
   "order": 1,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 3000,
   "notes": "50 דקות",
   "intensity": {
    "fastPct": 79.3,
    "slowPct": 69.7
   },
   "targetZone": "easy"
  },
  {
   "type": "interval",
   "order": 2,
   "targetType": "no_target",
   "repeatCount": 5,
   "durationType": "time",
   "durationValue": 20,
   "notes": "מתגברת",
   "repeatSteps": [
    {
     "type": "interval",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 20,
     "notes": "מתגברת"
    },
    {
     "type": "rest",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 40,
     "notes": "הליכה"
    }
   ]
  }
 ],
 "5 × 500 מ׳": [
  {
   "type": "warmup",
   "order": 1,
   "targetType": "pace",
   "durationType": "distance",
   "durationValue": 2000,
   "intensity": {
    "fastPct": 78.2,
    "slowPct": 75.2
   },
   "targetZone": "easy"
  },
  {
   "type": "active",
   "order": 2,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 1800,
   "intensity": {
    "fastPct": 82.1,
    "slowPct": 76.7
   },
   "targetZone": "easy"
  },
  {
   "type": "active",
   "order": 3,
   "targetType": "pace",
   "durationType": "time",
   "durationValue": 7200,
   "notes": "2 שעות",
   "intensity": {
    "fastPct": 91.7,
    "slowPct": 88.7
   },
   "targetZone": "marathon_pace"
  },
  {
   "type": "interval",
   "order": 4,
   "targetType": "pace",
   "repeatCount": 5,
   "durationType": "distance",
   "durationValue": 500,
   "repeatSteps": [
    {
     "type": "interval",
     "targetType": "pace",
     "durationType": "distance",
     "durationValue": 500,
     "intensity": {
      "fastPct": 111,
      "slowPct": 108
     },
     "targetZone": "interval"
    },
    {
     "type": "rest",
     "targetType": "no_target",
     "durationType": "time",
     "durationValue": 60,
     "notes": "הליכה"
    }
   ]
  }
 ]
} as never;
const TEMPO_SET: LibraryStep[] = [{"type": "warmup", "order": 1, "targetType": "pace", "durationType": "time", "durationValue": 1800, "intensity": {"fastPct": 79.3, "slowPct": 69.7}, "targetZone": "easy"}, {"type": "interval", "order": 2, "targetType": "pace", "durationType": "time", "durationValue": 120, "intensity": {"fastPct": 101.5, "slowPct": 98.5}, "targetZone": "threshold"}, {"type": "interval", "order": 3, "targetType": "pace", "durationType": "time", "durationValue": 120, "intensity": {"fastPct": 106, "slowPct": 103}, "targetZone": "interval"}, {"type": "interval", "order": 4, "targetType": "pace", "durationType": "time", "durationValue": 120, "intensity": {"fastPct": 111, "slowPct": 108}, "targetZone": "interval"}, {"type": "interval", "order": 5, "targetType": "no_target", "repeatCount": 5, "durationType": "time", "durationValue": null, "repeatSteps": [{"type": "interval", "targetType": "no_target", "durationType": "time", "durationValue": 30, "notes": "מתגברת"}, {"type": "recovery", "targetType": "no_target", "durationType": "time", "durationValue": 90, "notes": "ג׳וג"}]}] as never;
const name = (k: string) => structureName(fromLibrarySteps(REAL[k])!);

describe('the main part names the session', () => {
  it('40 min easy + 6 × 20 s is an easy run with strides', () => {
    expect(name('6 × 20 שנ׳')).toBe('קל 45 דק׳ + 6 × 20 שנ׳ האצות');
  });
  it('a 24 km session with two 20 s accents is the long run', () => {
    const m = fromLibrarySteps(REAL['2 × 20 שנ׳'])!;
    expect(Math.round(bookTotals(m, null).distanceM / 1000)).toBeGreaterThanOrEqual(23);
    expect(name('2 × 20 שנ׳')).toBe('ארוכה 24 ק״מ + 2 האצות');
  });
  it('50 min easy + 5 × 20 s', () => {
    expect(name('5 × 20 שנ׳')).toBe('קל 55 דק׳ + 5 × 20 שנ׳ האצות');
  });
  it('a real interval session keeps its set as its name', () => {
    expect(name('15 × 200 מ׳')).toBe('15 × 200 מ׳');
    expect(name('5 × 500 מ׳')).toBe('5 × 500 מ׳');
  });
  it('3 × 2 min in tempo with 5 × 30 s after it is a set, not strides', () => {
    expect(structureName(fromLibrarySteps(TEMPO_SET)!)).not.toMatch(/האצות/);
  });
});
