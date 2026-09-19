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

  it('does not promise the trainee was told before the coach has sent it', () => {
    // Approving is a decision about numbers and tells the trainee nothing. A footer implying it
    // went out would be a lie the coach acts on.
    expect(sheet).toContain('המתאמן לא מקבל כלום עד');
  });
});

describe('sending it to the trainee', () => {
  const send = read('app/api/academy/test-analysis/send/route.ts');
  const thread = read('lib/academy/thread-server.ts');

  it('is a separate tap from approving', () => {
    // An outward-facing write gets its own button. A coach working through eight analyses must not
    // find out afterwards that he also sent eight messages.
    expect(sheet).toContain("fetch('/api/academy/test-analysis/send'");
    expect(sheet).toContain('approvedAndSaved');
    // And the analysis route itself still sends nothing.
    expect(read('app/api/academy/test-analysis/route.ts')).not.toContain('postAcademyTestSummary');
  });

  it('sends the stored text, and says so when the screen has unsaved edits', () => {
    // The route reads the row, so an unsaved textarea would send a version the coach can see he
    // has changed. Refused on the screen rather than silently.
    expect(send).toContain('String(analysis.summary || \'\').trim()');
    expect(sheet).toContain('disabled={busy || summaryUnsaved}');
    expect(sheet).toContain("summary.trim() !== String(stored?.summary ?? '').trim()");
  });

  it('edits the message the trainee already has instead of sending a second one', () => {
    expect(thread).toContain('export function academyTestSummaryMessageId');
    expect(thread).toContain('`acadtest-${testId}`');
    expect(thread).toContain('stream.updateMessage(');
  });

  it('travels as text, because an unknown attachment renders as nothing', () => {
    // `toThreadMessages` drops messages with neither text nor a known card, so a card-only test
    // summary would reach the trainee as an empty bubble.
    const fn = thread.slice(thread.indexOf('export async function postAcademyTestSummary'));
    expect(fn).toContain('text,');
    expect(fn).not.toContain('academy_feedback');
  });

  it('never records a delivery that did not happen', () => {
    expect(send).toContain('if (!delivery.posted)');
    const after = send.slice(send.indexOf('if (!delivery.posted)'));
    expect(after.indexOf('sent_at: sentAt')).toBeGreaterThan(0);
  });

  it('tells the coach when the trainee is holding an earlier version', () => {
    expect(sheet).toContain('sentIsStale');
    expect(sheet).toContain('למתאמן יש גרסה מוקדמת יותר');
  });

  it('refuses to put a sent analysis back into draft', () => {
    // It cannot be unsent, so "not yet sent" would be false about a message somebody has read.
    expect(read('app/api/academy/test-analysis/route.ts')).toContain("code: 'already_sent'");
  });

  it('survives migration 114 not being pasted yet', () => {
    // Selecting a column PostgREST has never heard of fails the whole select, which would take the
    // analysis screen down over a timestamp.
    expect(read('app/api/academy/test-analysis/route.ts')).toContain('async function selectAnalysis');
    expect(send).toContain('isMissingColumn(stampError)');
    expect(sheet).toContain('deliveryMissing');
  });
});
