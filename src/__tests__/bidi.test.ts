import { describe, expect, it } from 'vitest';
import { ltr, splitNumericRuns, textDir } from '@/lib/bidi';

// Why this exists: the Plan tab's session titles are metric expressions, and on
// an RTL page an unmarked "20 × 500 מ׳" is laid out right-to-left — the screen
// says "מ׳ 500 × 20". It is still a readable workout, just not the one written.

describe('textDir', () => {
  it('marks a metric expression as left-to-right', () => {
    expect(textDir('20 × 500 מ׳')).toBe('ltr');
    expect(textDir('3 × (2 × 2 ק״מ)')).toBe('ltr');
    expect(textDir('23.6–24.5 ק״מ')).toBe('ltr');
    expect(textDir('(2 × 2 ק״מ)')).toBe('ltr');
  });

  it('leaves Hebrew prose to the page', () => {
    // Monday evening's whole prescription is a sentence. Forcing it LTR would
    // move its punctuation to the wrong end.
    expect(textDir('אופציה ל30-40 דק׳ קל בערב / כוח')).toBe('auto');
    expect(textDir('ITALIAN MEDIO')).toBe('auto');
    expect(textDir('')).toBe('auto');
  });

  it('ignores leading whitespace, which a joined title can carry', () => {
    expect(textDir('  20 ק״מ')).toBe('ltr');
  });
});

describe('ltr', () => {
  const LRI = String.fromCodePoint(0x2066);
  const PDI = String.fromCodePoint(0x2069);

  it('isolates a range for a translated sentence', () => {
    // No element to hang `dir` on inside t('optionalNote', { km }), so the
    // isolate travels with the value. "15-17" would otherwise read "17-15".
    expect(ltr('15–17')).toBe(LRI + '15–17' + PDI);
    expect(ltr(32)).toBe(LRI + '32' + PDI);
  });
});

/** The isolated runs, in order — what the renderer will wrap in `<bdi dir="ltr">`. */
const runs = (s: string) => splitNumericRuns(s).filter(p => p.isolate).map(p => p.text);
/** Reassembling must be lossless, or the helper silently edits what someone wrote. */
const rejoin = (s: string) => splitNumericRuns(s).map(p => p.text).join('');

describe('splitNumericRuns', () => {
  it('isolates the run that actually swapped in the thread', () => {
    expect(runs('נעה, שמתי לך את האינטרוולים למחר. 8×1000 בקצב 4:00')).toEqual(['8×1000', '4:00']);
  });

  it('leaves a lone number alone — it already lays out correctly', () => {
    // "מחכה 3 ימים" measured correct in the inbox, so there is nothing to fix and
    // isolating every digit in the app would be a change with no defect behind it.
    expect(runs('מחכה 3 ימים')).toEqual([]);
    expect(runs('התאוששות 2 דקות')).toEqual([]);
  });

  it('isolates a separator carrying spaces, which is the case W4 does NOT save', () => {
    // The repo already met this one as "1 / 12" reading as "12 / 1".
    expect(runs('שבוע 1 / 12')).toEqual(['1 / 12']);
    expect(runs('שבוע 1/12')).toEqual(['1/12']);
  });

  it('isolates ranges and paces', () => {
    expect(runs('קצב 4:00-4:10 לקילומטר')).toEqual(['4:00-4:10']);
    expect(runs('דופק 150–160')).toEqual(['150–160']);
  });

  it('does not swallow the Hebrew around a number', () => {
    const parts = splitNumericRuns('פתחת ב-3:48 במקום 4:00');
    // A prefix like "ב-" is Hebrew plus a dash and must stay OUT of the isolate:
    // isolating a Hebrew word forces it left-to-right, which is the bigger bug.
    expect(parts.filter(p => p.isolate).every(p => /^[\d\s×x*:/.,+=~–-]+$/.test(p.text))).toBe(true);
  });

  it('is lossless on every case, including empty and digit-free text', () => {
    for (const s of [
      '',
      'אין כאן מספרים בכלל',
      '8×1000',
      '  8 × 1000  ',
      'רק 7',
      'אימון 16.9.2026 בשעה 19:15',
    ]) {
      expect(rejoin(s)).toBe(s);
    }
  });

  it('handles several runs in one sentence without merging them', () => {
    expect(runs('6×400 בקצב 3:30, התאוששות 1:30')).toEqual(['6×400', '3:30', '1:30']);
  });

  it('returns a single plain segment when there is nothing to isolate', () => {
    expect(splitNumericRuns('שבוע טוב')).toEqual([{ text: 'שבוע טוב', isolate: false }]);
  });
});
