import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The analysis screen's wiring, asserted by reading the source.
 *
 * There is no @testing-library/react in this repo, so component behaviour is guarded the way
 * `athleteProfileLinks.test.ts` and `academyTestRoundWiring.test.ts` guard it: by reading the file.
 * The engine and the route have their own tests; what only the components can get wrong is which
 * test gets analysed, whether an edit reaches the request, and whether a screen that failed to do
 * what it said says so.
 */

const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const sheet = read('components/academy/TestAnalysisSheet.tsx');
const registry = read('components/academy/TestRegistry.tsx');
const tests = read('lib/academy/tests.ts');

describe('which test is analysed', () => {
  it('analyses the test the registry row is already showing', () => {
    // The whole reason `lastTestId` is carried on the row. Refetching "this athlete's latest
    // test" in the sheet would let the screen analyse one test while the row behind it shows
    // another, and the coach has no way to see that the two disagree.
    expect(tests).toContain('lastTestId: string | null');
    expect(tests).toContain('lastTestId: last?.testId ?? null');
    expect(registry).toContain('onAnalyse={row => setAnalysing(row.lastTestId)}');
    expect(registry).toContain('testId={analysing}');
  });

  it('offers no analysis where there is no usable test', () => {
    expect(registry).toContain('onAnalyse && row.lastTestId ? () => onAnalyse(row) : undefined');
    // And the button is conditional inside the row too, not merely inert.
    expect(registry).toContain('{onAnalyse && (');
  });

  it('asks the route for that one test by id', () => {
    expect(sheet).toContain('/api/academy/test-analysis?testId=${encodeURIComponent(testId)}');
  });

  it('re-reads the registry after an approval', () => {
    // Approving moves `academy_band_id`, and the per-band rollup under the list is drawn from it.
    const slice = registry.slice(registry.indexOf('<TestAnalysisSheet'));
    expect(slice).toContain('onApproved={() => { void load(); }}');
  });
});

describe('the edit', () => {
  it('moves the derived paces with the threshold rather than leaving them behind', () => {
    // A 4:40-based easy pace under a 4:52 threshold is two opinions in one table. The multiples
    // come from the engine so the screen cannot drift from what the route will store.
    expect(sheet).toContain("import { PACE_MULTIPLE");
    expect(sheet).toContain('threshold * PACE_MULTIPLE.easy');
    expect(sheet).toContain('threshold * PACE_MULTIPLE.interval');
  });

  it('sends all three paces, so a one-field edit cannot blank the rest', () => {
    const body = sheet.slice(sheet.indexOf('approved: {'), sheet.indexOf('}),\n      });'));
    for (const key of ['thresholdPaceSec', 'easyPaceSec', 'intervalPaceSec']) {
      expect(body).toContain(`${key}: paces.${key}`);
    }
  });

  it('marks an edited number as edited instead of calling it calculated', () => {
    // The `מקור` column is the point of the table: "the formula says this" and "the coach says
    // this" are different claims, and a coach reading his own override as `מחושב` is being told
    // the app agrees with him when it does not.
    expect(sheet).toContain("source={paces.isEdited ? null : 'calculated'} edited={paces.isEdited}");
    expect(sheet).toContain('isEdited: threshold !== computed.thresholdPaceSec');
  });
});

describe('what the screen refuses to claim', () => {
  it('does not turn the average heart rate into a threshold heart rate', () => {
    // Migration 105's rule, repeated on the screen rather than only in the code: the field
    // estimate is the average of the LAST twenty minutes, and this is the average of thirty.
    expect(sheet).toContain('לא דופק סף');
    expect(sheet).not.toContain('thresholdHr');
  });

  it('says which kind of missing a missing band recommendation is', () => {
    // Two gaps with two different next steps. One empty state would send a coach to the wrong one.
    expect(sheet).toContain("reason === 'no_bands'");
    expect(sheet).toContain('אין המלצה אוטומטית');
  });

  it('names the migration when the table is not there', () => {
    expect(sheet).toContain("body?.tableMissing) { setState('missing')");
    expect(sheet).toContain('113');
  });

  it('says out loud when the signature did not move the band', () => {
    // `academy_band_id` is what the plan composer reads, so an approval whose band write failed
    // is signed and ineffective — the one outcome here that would otherwise be invisible.
    expect(sheet).toContain("body?.bandAssigned === false");
    expect(sheet).toContain('שיבוץ הדבוקה נכשל');
  });

  it('does not promise the trainee was told', () => {
    // No notification is sent from here. The summary reaching the trainee is its own slice, and a
    // footer implying it went out would be a lie the coach acts on.
    expect(sheet).toContain('לא נשלח');
  });
});
