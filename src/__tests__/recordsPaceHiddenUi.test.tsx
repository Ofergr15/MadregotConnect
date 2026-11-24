import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { PrSection } from '@/components/profile/AthleteProfileBody';
import { BestEfforts, type RunAnalysisData } from '@/components/activity/RunAnalysis';

/** A pace-hider's records reach a teammate as seconds:null + paceHidden (PR #86):
 * the row must say "hidden by choice", never read as "no record". */
const wrap = (node: React.ReactNode) => renderToStaticMarkup(
  <NextIntlClientProvider locale="he" messages={he} timeZone="Asia/Jerusalem">{node}</NextIntlClientProvider>,
);
const HIDDEN = 'מוסתר · בחר/ה להסתיר קצב';

describe('record times of a pace-hider, as a teammate sees them', () => {
  it('has the key in both locales', () => {
    expect((he as any).profile.prPaceHidden).toBe(HIDDEN);
    expect((en as any).profile.prPaceHidden).toBe('Hidden · chose to hide pace');
  });

  it('PrSection keeps the section and renders a hidden row per distance, no time, no "not yet"', () => {
    const prs = ['5k', '10k'].map((key) => ({ key, label: key, seconds: null, date: null, activityName: null, paceHidden: true }));
    const html = wrap(<PrSection athleteId="a1" prs={prs as any} />);
    expect(html.split(HIDDEN).length - 1).toBe(2);
    expect(html).not.toContain(he.profile.prNone);
    expect(html).not.toContain(he.profile.noPrsYet);
    expect(html).not.toMatch(/\d+:\d\d/);
  });

  it('BestEfforts says the record is hidden instead of leaving the cell blank', () => {
    const a = { efforts: [{ key: '1k', meters: 1000, seconds: 230, start: 0, rep: null }], prs: {}, prsPaceHidden: true } as unknown as RunAnalysisData;
    expect(wrap(<BestEfforts a={a} />)).toContain(HIDDEN);
    expect(wrap(<BestEfforts a={{ ...a, prsPaceHidden: undefined }} />)).not.toContain(HIDDEN);
  });
});
