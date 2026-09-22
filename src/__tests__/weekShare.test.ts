import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { buildLast7Report, type ReportActivity } from '@/lib/reports/last-7-days';
import {
  WEEK_CARD_TEXT, WEEK_METRICS, availableMetrics, defaultMetricKeys, selectedMetrics,
} from '@/lib/reports/week-share';
import { formatWeekRange } from '@/lib/reports/week-share-image';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * Sharing the seven-day report. The metric picker is the part worth pinning: a chip
 * that is offered but has no data prints a dash on something the athlete posts
 * publicly, and a card with no rows at all is an empty panel.
 */

const run = (
  start: string, km: number, secs: number,
  extra: Partial<ReportActivity> = {},
): ReportActivity => ({
  activity_type: 'running', start_time: start, distance: km * 1000, duration: secs, ...extra,
});

const WEEK = '2026-09-19';
const plain = () => buildLast7Report([
  run('2026-09-15T05:00:00Z', 10, 3000),
  run('2026-09-17T05:00:00Z', 5, 1500),
], WEEK);

describe('the report carries the optional metrics', () => {
  it('sums climb and calories per day and for the week', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 10, 3000, { elevation_gain: 120, calories: 700 }),
      run('2026-09-15T16:00:00Z', 5, 1500, { elevation_gain: 30, calories: 320 }),
    ], WEEK);
    const day = r.days.find((d) => d.date === '2026-09-15')!;
    expect(day.elevation).toBe(150);
    expect(day.calories).toBe(1020);
    expect(r.elevation).toBe(150);
    expect(r.calories).toBe(1020);
  });

  it('treats a missing climb as zero, not NaN — Strava rows arrive without one', () => {
    const r = plain();
    expect(r.elevation).toBe(0);
    expect(r.calories).toBe(0);
    expect(Number.isNaN(r.elevation)).toBe(false);
  });
});

describe('which chips are offered', () => {
  it('offers only what this athlete actually recorded', () => {
    const keys = availableMetrics(plain()).map((m) => m.key);
    expect(keys).toEqual(['km', 'time', 'pace', 'runs']);
    // The whole point: no chip that would render a dash on a public story.
    expect(keys).not.toContain('elev');
    expect(keys).not.toContain('cal');
  });

  it('adds climb and calories the moment the watch reports them', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 10, 3000, { elevation_gain: 120, calories: 700 }),
    ], WEEK);
    expect(availableMetrics(r).map((m) => m.key)).toEqual(['km', 'time', 'pace', 'runs', 'elev', 'cal']);
  });

  it('offers nothing at all for a week with no runs', () => {
    expect(availableMetrics(buildLast7Report([], WEEK))).toEqual([]);
  });

  it('opens on the four the Saturday push already reads out', () => {
    expect(defaultMetricKeys(plain())).toEqual(['km', 'time', 'pace', 'runs']);
  });

  it('does not default the extras on, so the card stays the same shape for everyone', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 10, 3000, { elevation_gain: 120, calories: 700 }),
    ], WEEK);
    expect(defaultMetricKeys(r)).not.toContain('elev');
    expect(defaultMetricKeys(r)).not.toContain('cal');
  });
});

describe('the rows that get drawn', () => {
  it('follow the card order, not the order the chips were tapped', () => {
    const rows = selectedMetrics(plain(), ['runs', 'km']).map((m) => m.key);
    expect(rows).toEqual(['km', 'runs']);
  });

  it('ignore a key this athlete cannot print', () => {
    expect(selectedMetrics(plain(), ['km', 'elev']).map((m) => m.key)).toEqual(['km']);
  });

  it('print the same numbers the profile card and the push print', () => {
    const r = plain();
    const by = Object.fromEntries(WEEK_METRICS.map((m) => [m.key, m.total(r)]));
    expect(by.km).toBe('15');
    expect(by.time).toBe('1:15');   // 4500 s
    expect(by.pace).toBe('5:00');   // 4500 s over 15 km
    expect(by.runs).toBe('2');
  });

  it('rounds a climb to whole metres', () => {
    const r = buildLast7Report([
      run('2026-09-15T05:00:00Z', 10, 3000, { elevation_gain: 120.7 }),
    ], WEEK);
    expect(WEEK_METRICS.find((m) => m.key === 'elev')!.total(r)).toBe('121');
  });
});

describe('the card prints in either language', () => {
  it('labels every metric in both, so a new metric cannot ship half-translated', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const m of WEEK_METRICS) {
        expect(WEEK_CARD_TEXT[lang].labels[m.key], `${lang}.${m.key}`).toBeTruthy();
      }
      expect(WEEK_CARD_TEXT[lang].title).toBeTruthy();
    }
  });

  it('does not print Hebrew on an English card', () => {
    const hebrew = /[֐-׿]/;
    expect(hebrew.test(JSON.stringify(WEEK_CARD_TEXT.en))).toBe(false);
    expect(hebrew.test(WEEK_CARD_TEXT.he.labels.km)).toBe(true);
  });
});

describe('the date range on the card', () => {
  it('reads left-to-right in English', () => {
    expect(formatWeekRange(plain(), false)).toBe('13.09 – 19.09');
  });

  it('puts the later date first in Hebrew, because the line is laid out RTL', () => {
    // Otherwise a Hebrew reader sees the window ending on the day it opened.
    expect(formatWeekRange(plain(), true)).toBe('19.09 – 13.09');
  });
});

describe('the canvas card', () => {
  const img = read('lib/reports/week-share-image.ts');

  it('is the same 1080×1920 frame as a single activity, using its helpers', () => {
    expect(img).toMatch(/STORY_W, STORY_H, drawCover, drawShareBars, loadImage, resolveFontStack, roundRectPath/);
    expect(img).toMatch(/from '@\/lib\/feed\/share-image'/);
    // No second copy of the crop or the font resolution to drift from the original.
    expect(img).not.toMatch(/function drawCover|function resolveFontStack/);
  });

  it('opens on the club photo, with the gradient as the floor', () => {
    expect(img).toMatch(/DEFAULT_WEEK_BACKGROUND = '\/images\/runners-group\.jpg'/);
    expect(img).toMatch(/createLinearGradient/);
  });

  it('draws the club mark big and centred, not tucked in a corner', () => {
    expect(img).toMatch(/LOGO_SIZE = 260/);
    expect(img).toMatch(/\(STORY_W - w\) \/ 2/);
  });

  it('prints the range alone when the name is left off', () => {
    expect(img).toMatch(/\[opts\.athleteName\?\.trim\(\), formatWeekRange\(report, rtl\)\]/);
    expect(img).toMatch(/\.filter\(Boolean\)\.join\(' · '\)/);
  });

  it('takes its language from the card, not from the app locale', () => {
    expect(img).toMatch(/const rtl = opts\.lang === 'he'/);
    expect(img).toMatch(/WEEK_CARD_TEXT\[opts\.lang\]/);
  });

  it('draws one row per CHOSEN metric, from the shared selector', () => {
    expect(img).toMatch(/selectedMetrics\(report, opts\.metrics\)/);
  });

  it('survives a browser with no ctx.filter instead of throwing', () => {
    const at = img.indexOf("ctx.filter = 'blur");
    expect(at).toBeGreaterThan(-1);
    expect(img.slice(at - 60, at + 160)).toMatch(/try \{/);
  });
});

/**
 * The sheet is no longer the weekly card's own. It was the better of the two, so
 * it became the shared one — see `components/ShareSheet.tsx` and the merge tests
 * in `shareSheetMerge.test.ts`. What is asserted here is only what the WEEK must
 * still get out of it, unchanged.
 */
describe('the sheet', () => {
  const sheet = read('components/ShareSheet.tsx');

  it('renders a chip per available metric and nothing more', () => {
    expect(sheet).toMatch(/chips\.map\(/);
    // The list itself is `shareChips`, which reads availableMetrics for a week.
    expect(read('lib/share/sheet-model.ts')).toMatch(/availableMetrics\(subject\.report\)/);
  });

  it('cannot be emptied — the last chip stays on', () => {
    expect(read('lib/share/sheet-model.ts')).toMatch(/keys\.length === 1 \? keys : keys\.filter/);
  });

  it('offers both card languages and opens in the one being read', () => {
    expect(sheet).toMatch(/SHARE_CARD_LANGS\.map/);
    expect(sheet).toMatch(/useState<ShareCardLang>\(rtl \? 'he' : 'en'\)/);
    expect(sheet).toMatch(/lang: cardLang/);
  });

  it('can leave the name off the card', () => {
    expect(sheet).toMatch(/athleteName: withName \? subject\.athleteName : null/);
    // No toggle to show when there is no name to hide.
    expect(sheet).toMatch(/subject\.kind === 'week' && !!subject\.athleteName/);
  });

  it('hands the blob to the OS share sheet, with the download fallback', () => {
    expect(sheet).toMatch(/shareCard\(blob, shareFilename\(subject, transparent\)\)/);
    expect(read('lib/share/sheet-model.ts')).toMatch(/madregot-week-\$\{subject\.report\.to\}\.jpg/);
    expect(sheet).toMatch(/result === 'downloaded'/);
  });
});

describe('the entry point', () => {
  const card = read('components/profile/Last7DaysCard.tsx');

  it('is a share button on the profile card', () => {
    expect(card).toMatch(/<ShareSheet\n\s+subject=\{\{ kind: 'week', report, athleteName \}\}/);
    expect(card).toMatch(/setSharing\(true\)/);
  });

  it('is absent in a week with no runs', () => {
    expect(card).toMatch(/report\.runs > 0 && \(/);
  });

  it('carries the athlete name onto the card', () => {
    const body = read('components/profile/AthleteProfileBody.tsx');
    expect(body).toMatch(/athleteName=\{profile\?\.name\}/);
  });
});

describe('the stats route feeds the extra metrics', () => {
  it('selects climb and calories in the read it already performs', () => {
    const route = read('app/api/athletes/[id]/stats/route.ts');
    expect(route).toMatch(/elevation_gain, calories/);
  });
});

describe('every label exists in both languages', () => {
  it('has he/en parity on the share keys', () => {
    const keys = [
      'weekShareTitle', 'weekShareAction', 'weekShareWhat', 'weekShareKm', 'weekShareHours',
      'weekSharePace', 'weekShareRuns', 'weekShareElev', 'weekShareCal', 'weekSharePreview',
      'weekShareAddPhoto', 'weekShareChangePhoto', 'weekShareSaved', 'weekShareError',
      'weekShareName',
    ];
    const he = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8')).profile;
    const en = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8')).profile;
    for (const k of keys) {
      expect(he[k], `he.${k}`).toBeTruthy();
      expect(en[k], `en.${k}`).toBeTruthy();
    }
  });
});
