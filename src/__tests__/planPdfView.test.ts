import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const PAGE = 'app/(app)/dashboard/program/page.tsx';
const NUTRITION = 'components/NutritionPlanView.tsx';

/**
 * THE PLAN'S ORIGINAL PDF IS A VIEW, NOT A FOOTER (feedback 757fc57a).
 *
 * "Both the training plan and the nutrition plan should show the PDF view too, so
 * it is convenient." The file was already reachable on both tabs when this was
 * reported — which is the finding: on training it was appended below the whole
 * seven-day climb, on nutrition it was a collapsed disclosure below the entire
 * reflowed sheet, the two tabs did it differently, and neither said up front that a
 * PDF existed. Two long scrolls to two different text buttons is not an affordance.
 *
 * So it moved to one switch at the top, above the fold, identical on both tabs. The
 * regressions these tests exist to catch are the two ways that can quietly rot: a
 * second route to the same file growing back at the bottom of a tab, and the switch
 * being offered when there is nothing to switch to.
 */

describe('the plan view switch', () => {
  it('is one control, above the plan, on both plan tabs', () => {
    const src = read(PAGE);
    // Not `activeView === 'training' &&` — the switch is shared, and a per-tab copy
    // is how the two tabs drifted apart in the first place.
    expect(src).toMatch(/showViewSwitch = activeView !== 'workout' && !!planPdfUrl && hasAppView/);
    expect(src).toMatch(/\{showViewSwitch && \(\s*<SegmentedControl<'app' \| 'pdf'>/);
    expect(src).toMatch(/value=\{planView\}/);
    expect(src).toMatch(/t\('viewInApp'\)/);
    expect(src).toMatch(/t\('viewPdf'\)/);
  });

  it('only appears when there are two real views to choose between', () => {
    // A switch whose both sides draw the same PDF reads as a broken app view rather
    // than an absent one. Training needs a parsed week; nutrition needs a sheet that
    // reconstructed into text, which only NutritionPlanView can answer.
    const src = read(PAGE);
    expect(src).toMatch(
      /hasAppView = activeView === 'training' \? !!weekPlan\?\.hasPlan : nutritionTextOk === true/,
    );
    expect(src).toMatch(/onTextAvailable=\{setNutritionTextOk\}/);
    expect(read(NUTRITION)).toMatch(/report\.current\?\.\(!!built\)/);
    expect(read(NUTRITION)).toMatch(/report\.current\?\.\(false\)/);
  });

  it('forgets nothing between visits and nothing between weeks', () => {
    const src = read(PAGE);
    // The choice is remembered…
    expect(src).toMatch(/localStorage\.setItem\('plan_view', next\)/);
    expect(src).toMatch(/localStorage\.getItem\('plan_view'\) === 'pdf'/);
    // …but what the LAST sheet extracted is not. A new week is a new file, and a
    // stale `true` offers a text view this week may not have.
    expect(src).toMatch(
      /setNutritionTextOk\(null\); \}, \[selectedStart, activeView\]\)/,
    );
  });

  it('does not keep a second way in at the bottom of a tab', () => {
    // Both of the old buried buttons, and the message keys that labelled them.
    for (const rel of [PAGE, NUTRITION]) {
      expect(read(rel), rel).not.toMatch(/showOriginalPdf|hideOriginalPdf|showTrainingPdf/);
    }
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const m = JSON.parse(read(f));
      expect(m.program.showOriginalPdf, f).toBeUndefined();
      expect(m.program.hideOriginalPdf, f).toBeUndefined();
      expect(m.program.viewInApp, f).toBeTruthy();
      expect(m.program.viewPdf, f).toBeTruthy();
    }
  });

  it('still shows the PDF alone when the app has no view of its own', () => {
    // The week of 2026-09-13 in prod has a nutrition sheet and no training one; other
    // weeks are the reverse. Neither may lose its plan to a switch that isn't there.
    const src = read(PAGE);
    expect(src).toMatch(/currentWeek && getPdfUrl\(currentWeek, activeView\) \?/);
    expect(src).toMatch(/activeView === 'training' && weekPlan\?\.hasPlan \?/);
  });
});
