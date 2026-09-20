import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How the composer uses the characterization answers, asserted by reading the source.
 *
 * No @testing-library/react in this repo, so the screen's contract is guarded the way the other
 * academy screens guard theirs. What only the component can get wrong here is BLOCKING on an
 * answer, or letting an absent answer become a default.
 */

const composer = readFileSync(join(process.cwd(), 'src/components/AcademyPlanComposer.tsx'), 'utf8');

describe('advisory, never blocking', () => {
  it('never disables a day or the push because of what the call said', () => {
    // The answers are weeks old by the second plan, and the coach knows things the table does not.
    // Every day of the week has to stay writable; the board just says so out loud first.
    const gated = /disabled=\{[^}]*(clash|fit\.|primaryInputs)/.test(composer);
    expect(gated).toBe(false);
    // The existing push guard is unchanged: empty board or no recipients, and nothing else.
    expect(composer).toContain('disabled={pushing || filledDays.length === 0 || selected.length === 0}');
  });

  it('keeps the clash on the day it is about rather than in a list at the bottom', () => {
    expect(composer).toContain('clashByDay.get(day)');
    expect(composer).toContain('לא מתאמן/ת ביום זה');
  });
});

describe('an absent answer stays absent', () => {
  it('reads the map with an explicit null rather than defaulting a recipient', () => {
    // `planInputs[a.id] ?? null` is the whole rule: `plan-fit.ts` says nothing about a null, and
    // an empty object would have read as "trains no days" and clashed with the entire week.
    expect(composer).toContain('inputs: planInputs[a.id] ?? null');
  });

  it('renders the context strip only when there is something in it', () => {
    expect(composer).toContain('primaryInputs && primary && (');
    expect(composer).toContain('primaryInputs.availableDays.length > 0');
  });

  it('survives the fetch failing, like the book and the thresholds do', () => {
    const effect = composer.slice(composer.indexOf('/api/academy/plan-inputs'));
    expect(effect.slice(0, 400)).toContain('.catch(() => {})');
  });
});

describe('what the strip says', () => {
  it('shows the limitation verbatim and nothing derived from it', () => {
    expect(composer).toContain('{primaryInputs.limitation}');
    expect(composer).toContain('מגבלה: ');
  });

  it('wraps every number in a bidi isolate, like the rest of the RTL screens', () => {
    const strip = composer.slice(composer.indexOf('משיחת האפיון של'), composer.indexOf('{/* Day slots */}'));
    expect(strip).toContain('<bdi dir="ltr">{primaryInputs.weeklyKm}</bdi>');
    expect(strip).toContain('<bdi dir="ltr">{countdown.weeks}</bdi>');
  });

  it('says "at least" when the week\'s total is only a floor', () => {
    expect(composer).toContain('j.partial ? `לפחות ${j.plannedKm}`');
  });
});

describe('one source for the findings', () => {
  it('derives every note from the single weekFit call', () => {
    expect(composer).toContain('const fit = useMemo(() => weekFit({');
    for (const key of ['fit.jumps', 'fit.unusedDays', 'fit.uncharacterised', 'fit.anything']) {
      expect(composer).toContain(key);
    }
    // No second opinion about who clashes: the component does not filter availableDays itself.
    expect(composer).not.toContain('availableDays.includes(day)');
  });

  it('reads a book day\'s volume from its steps and a written day\'s from its estimate', () => {
    // Two different mechanisms, which is exactly why the pure module takes numbers.
    expect(composer).toContain('getWorkoutKm(s.workout).min');
    expect(composer).toContain('entryVolume(s.entry.steps).distanceM / 1000');
    // A minutes-only session is unknown, not zero — zero would shrink the week and read as rest.
    expect(composer).toContain('km: km > 0 ? km : null');
  });
});
