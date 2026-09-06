import { describe, expect, it } from 'vitest';
import { ltr, textDir } from '@/lib/bidi';

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
