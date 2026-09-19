import { describe, expect, it } from 'vitest';
import {
  RIEGEL_EXPONENT,
  analyzeTest,
  draftSummary,
  equivalentDistanceM,
  recommendBand,
  riegelSec,
} from '@/lib/academy/testAnalysis';
import { thresholdPaceSec } from '@/lib/academy/tests';
import type { AcademyBand } from '@/lib/academy/bands';

/**
 * Funnel step 8 — what a test MEANS.
 *
 * These numbers do not stay on a screen. They become the pace alert on a watch for eight
 * repetitions and the price of every workout in a plan, so the things worth testing here are not
 * the multiplications: they are the places where being wrong is invisible. That the threshold
 * agrees with the registry's own. That a 2000m is not reported as a threshold effort. That a
 * units slip is caught. That an absent band recommendation says which kind of absent it is.
 */

// The mockup's own trainee: 6.42 km in 30 minutes, average HR 178.
const DOR = { protocol: '30min', durationSec: 1800, distanceM: 6420, avgHr: 178 };

describe('the threshold a test produces', () => {
  it('is the same number the registry shows for a 30-minute test', () => {
    // The whole reason this file imports from tests.ts. A screen that says 4:52 above a registry
    // row that says 4:40 for one test is a screen a coach has to ask the app about twice.
    const analysis = analyzeTest(DOR)!;
    expect(analysis.thresholdPaceSec).toBe(Math.round(thresholdPaceSec(DOR)!));
    expect(analysis.thresholdAdjusted).toBe(false);
  });

  it('does not report a 2000m effort as a threshold pace', () => {
    // Seven minutes flat out is somewhere near interval pace. Left uncorrected, this screen
    // would hand a beginner a threshold 40 s/km too fast and call it their easy-week anchor.
    const short = { protocol: '2000m', durationSec: 420, distanceM: 2000, avgHr: null };
    const analysis = analyzeTest(short)!;
    expect(analysis.thresholdAdjusted).toBe(true);
    expect(analysis.thresholdPaceSec).toBeGreaterThan(thresholdPaceSec(short)!);
  });

  it('leaves a stopwatch started late alone', () => {
    // 28:30 for a 30-minute test is the same effort, not a different physiology.
    const analysis = analyzeTest({ ...DOR, durationSec: 1710 })!;
    expect(analysis.thresholdAdjusted).toBe(false);
  });

  it('returns null rather than a table of zeroes when the row cannot produce one', () => {
    expect(analyzeTest({ protocol: '30min', durationSec: 1800, distanceM: 0, avgHr: null })).toBeNull();
    expect(analyzeTest({ protocol: '30min', durationSec: 0, distanceM: 6420, avgHr: null })).toBeNull();
  });
});

describe('the heart rate', () => {
  it('is reported as the measured average and never corrected into a threshold HR', () => {
    // Migration 105 refuses to call this column threshold_hr for a reason: the field estimate is
    // the average of the LAST twenty minutes, and inventing the difference here would write two
    // to five made-up beats into every HR workout this athlete ever gets.
    expect(analyzeTest(DOR)!.avgHrBpm).toBe(178);
  });

  it('is null when the watch recorded none, rather than a guess from the pace', () => {
    expect(analyzeTest({ ...DOR, avgHr: null })!.avgHrBpm).toBeNull();
    expect(analyzeTest({ ...DOR, avgHr: 0 })!.avgHrBpm).toBeNull();
  });
});

describe('the training paces', () => {
  it('puts the easy run slower than threshold and the intervals faster', () => {
    // The direction is the whole safety property. A sign error here sends a trainee out to run
    // their easy days at threshold, which is the commonest way a self-coached runner stalls.
    const a = analyzeTest(DOR)!;
    expect(a.easyPaceSec).toBeGreaterThan(a.thresholdPaceSec);
    expect(a.intervalPaceSec).toBeLessThan(a.thresholdPaceSec);
  });

  it('keeps the easy pace within a range a person would actually run', () => {
    // 4:40 threshold → about 5:39 easy. Loose bounds on purpose: this asserts the coefficient is
    // in the right neighbourhood, not the coefficient itself, which is a guess awaiting Ofer.
    const a = analyzeTest(DOR)!;
    expect(a.easyPaceSec - a.thresholdPaceSec).toBeGreaterThan(30);
    expect(a.easyPaceSec - a.thresholdPaceSec).toBeLessThan(120);
  });
});

describe('the race predictions', () => {
  it('follows Riegel rather than a straight pace multiplication', () => {
    // A straight multiplication would predict a marathon at 30-minute-test pace, which is the
    // arithmetic that produces a 3:17 marathon for a runner who has never raced one.
    const marathon = analyzeTest(DOR)!.predictions.find(p => p.distanceM === 42195)!;
    const flat = Math.round(thresholdPaceSec(DOR)! * 42.195);
    expect(marathon.sec).toBeGreaterThan(flat);
    // Around 3:40 for this trainee — within a few minutes of the mockup's hand-written 3:38.
    expect(marathon.sec).toBeGreaterThan(3 * 3600 + 30 * 60);
    expect(marathon.sec).toBeLessThan(3 * 3600 + 50 * 60);
  });

  it('gets slower with every distance, which is the only monotonic claim worth making', () => {
    const paces = analyzeTest(DOR)!.predictions.map(p => p.paceSec);
    for (let i = 1; i < paces.length; i += 1) expect(paces[i]).toBeGreaterThan(paces[i - 1]);
  });

  it('reports each prediction with the pace it implies, so it can be checked by eye', () => {
    const p = analyzeTest(DOR)!.predictions.find(x => x.distanceM === 10000)!;
    expect(p.paceSec).toBe(Math.round(p.sec / 10));
  });

  it('uses the published exponent and nothing of my own', () => {
    expect(RIEGEL_EXPONENT).toBe(1.06);
    // 10k from a 5k, the textbook sanity check: about 2.08x, not 2x.
    const predicted = riegelSec(1200, 5000, 10000);
    expect(predicted / 1200).toBeCloseTo(Math.pow(2, 1.06), 3);
  });

  it('inverts cleanly, because the threshold correction depends on it', () => {
    // Thirty minutes' worth of distance, fed back in, must come out as thirty minutes.
    const d = equivalentDistanceM(420, 2000);
    expect(riegelSec(420, 2000, d)).toBeCloseTo(1800, 0);
  });
});

describe('a units slip', () => {
  it('is flagged rather than turned into somebody training paces', () => {
    // `6.42` typed into a metres field. The registry already warns about it; this screen is where
    // it would become a threshold of 4:40 per METRE and a plan built on it.
    const analysis = analyzeTest({ protocol: '30min', durationSec: 1800, distanceM: 6.42, avgHr: null })!;
    expect(analysis.implausible).toBe(true);
  });

  it('is not raised for a real test', () => {
    expect(analyzeTest(DOR)!.implausible).toBe(false);
  });
});

// ── the band ──────────────────────────────────────────────────────────────────

function band(over: Partial<AcademyBand> & { bandNumber: number }): AcademyBand {
  return {
    id: `band-${over.bandNumber}`,
    name: `דבוקה ${over.bandNumber}`,
    goal: null,
    paceProfile: {},
    ...over,
  };
}

describe('the band recommendation', () => {
  it('says the data is missing rather than inventing a mapping', () => {
    // The honest answer today, and the reason it is a `reason` and not a null: a recommendation
    // derived from a rule I made up is indistinguishable on screen from one derived from the
    // club's own experience, and the coach has no way to tell which they are being shown.
    const result = recommendBand(280, [band({ bandNumber: 6 }), band({ bandNumber: 7 })]);
    expect(result.band).toBeNull();
    expect(result.reason).toBe('bands_have_no_paces');
  });

  it('distinguishes "no bands at all" from "bands with no paces"', () => {
    // One is a setup gap with an obvious next step; the other is a data gap with a different
    // one, and a single empty state would send a coach looking in the wrong place.
    expect(recommendBand(280, []).reason).toBe('no_bands');
  });

  it('picks the nearest band once the thresholds are recorded', () => {
    const bands = [
      band({ bandNumber: 5, paceProfile: { thresholdPaceSec: 255 } }),
      band({ bandNumber: 6, paceProfile: { thresholdPaceSec: 280 } }),
      band({ bandNumber: 7, paceProfile: { thresholdPaceSec: 310 } }),
    ];
    const result = recommendBand(285, bands);
    expect(result.band?.bandNumber).toBe(6);
    expect(result.gapSec).toBe(5);
  });

  it('answers in the gaps between hand-written ranges', () => {
    // 4:47 between a band at 4:45 and one at 4:50. "No recommendation" here is the answer that
    // sends the coach back to the spreadsheet, which is the thing this screen replaces.
    const bands = [
      band({ bandNumber: 6, paceProfile: { thresholdPaceSec: 285 } }),
      band({ bandNumber: 7, paceProfile: { thresholdPaceSec: 290 } }),
    ];
    expect(recommendBand(287, bands).band?.bandNumber).toBe(6);
  });

  it('ignores bands with no threshold recorded instead of treating them as zero', () => {
    // A band whose profile is empty is not a band for a runner with a 0:00 threshold.
    const bands = [band({ bandNumber: 4 }), band({ bandNumber: 9, paceProfile: { thresholdPaceSec: 400 } })];
    expect(recommendBand(390, bands).band?.bandNumber).toBe(9);
  });
});

// ── the summary ───────────────────────────────────────────────────────────────

describe('the draft summary', () => {
  it('states the facts of the test in the trainee own units', () => {
    const analysis = analyzeTest(DOR)!;
    const text = draftSummary(DOR, analysis);
    expect(text).toContain('6.42');
    expect(text).toContain('4:40');
    expect(text).toContain('178');
  });

  it('leaves out the heart rate when there was none, rather than writing null', () => {
    const test = { ...DOR, avgHr: null };
    expect(draftSummary(test, analyzeTest(test)!)).not.toContain('דופק');
  });

  it('gets the direction of an improvement right', () => {
    // A pace is better when the number is SMALLER. This is the sign error the test exists for:
    // telling a trainee who got 12 s/km faster that they got slower is worse than saying nothing.
    const analysis = analyzeTest(DOR)!;
    const faster = draftSummary(DOR, analysis, { paceSec: thresholdPaceSec(DOR)! + 12 });
    expect(faster).toContain('מהר יותר');
    const slower = draftSummary(DOR, analysis, { paceSec: thresholdPaceSec(DOR)! - 12 });
    expect(slower).toContain('אטי יותר');
  });

  it('says nothing about a trend when there is no previous test', () => {
    const text = draftSummary(DOR, analyzeTest(DOR)!);
    expect(text).not.toContain('הקודם');
  });

  it('carries the derived paces, so the coach edits a draft and not a blank page', () => {
    const analysis = analyzeTest(DOR)!;
    const text = draftSummary(DOR, analysis);
    for (const sec of [analysis.thresholdPaceSec, analysis.easyPaceSec, analysis.intervalPaceSec]) {
      const mmss = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      expect(text).toContain(mmss);
    }
  });
});
