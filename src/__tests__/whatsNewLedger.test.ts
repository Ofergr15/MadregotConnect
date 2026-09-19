import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { WHATS_NEW, WHATS_NEW_LANGS, type WhatsNewEntry } from '@/lib/whats-new/entries';
import {
  WHATS_NEW_EPOCH, WHATS_NEW_KEY, WHATS_NEW_MAX_ROWS, deviceIsReturning, initLedger,
  markSeen, readWhatsNewLedger, recentEntries, unseenEntries, visibleEntries,
} from '@/lib/whats-new/ledger';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * The what's-new sheet. Every rule pinned here is one the research is explicit
 * about, and each one is about a moment the sheet would otherwise be an
 * interruption that taught people to ignore the next one.
 */

const E = (slug: string, publishedAt: string): WhatsNewEntry => ({
  slug, publishedAt, art: 'weekShare', href: '/x',
  he: { title: slug, body: slug }, en: { title: slug, body: slug },
});

const fresh = () => readWhatsNewLedger(null);

describe('the ledger survives whatever is in storage', () => {
  it('reads nothing as fresh', () => {
    expect(fresh()).toEqual({ seen: [], since: null });
  });

  it('reads junk as fresh rather than throwing the feed away', () => {
    expect(readWhatsNewLedger('{not json')).toEqual({ seen: [], since: null });
    expect(readWhatsNewLedger('{"seen":"all","since":7}')).toEqual({ seen: [], since: null });
  });

  it('keeps only string slugs', () => {
    expect(readWhatsNewLedger('{"seen":["a",3,null,"b"]}').seen).toEqual(['a', 'b']);
  });
});

describe('a device that is opening the app for the first time', () => {
  it('is stamped with today, so nothing already shipped is news to it', () => {
    const ledger = initLedger(fresh(), '2026-09-19', false);
    expect(ledger.since).toBe('2026-09-19');
    // The whole of rule 1: somebody who joined today hears about nothing.
    expect(unseenEntries([E('a', '2026-09-18'), E('b', '2026-09-19')], ledger)).toEqual([]);
  });

  it('does hear about what ships tomorrow', () => {
    const ledger = initLedger(fresh(), '2026-09-19', false);
    expect(unseenEntries([E('a', '2026-09-20')], ledger).map((e) => e.slug)).toEqual(['a']);
  });
});

describe('a device that was already using the app', () => {
  it('is stamped in the past, so the first release of this module announces itself', () => {
    const ledger = initLedger(fresh(), '2026-09-19', true);
    expect(ledger.since).toBe(WHATS_NEW_EPOCH);
    expect(unseenEntries([E('a', '2026-09-18')], ledger).map((e) => e.slug)).toEqual(['a']);
  });

  it('is recognised by the keys normal use leaves behind', () => {
    expect(deviceIsReturning(['view_group'])).toBe(true);
    expect(deviceIsReturning(['athlete_name'])).toBe(true);
    expect(deviceIsReturning(['setup_nudge:abc'])).toBe(true);
    expect(deviceIsReturning(['mc:weekSummaryDismissed:2026-09-12'])).toBe(true);
  });

  it('is not inferred from the keys a fresh login writes', () => {
    // athlete_id is set the moment anyone signs in, including a brand-new member,
    // so it must never count as evidence of history.
    expect(deviceIsReturning(['athlete_id', 'mc:whatsNew'])).toBe(false);
    expect(deviceIsReturning([])).toBe(false);
  });
});

describe('the stamp is written once', () => {
  it('leaves an existing `since` alone — re-stamping would age every entry', () => {
    const old = { seen: [], since: '2026-01-01' };
    expect(initLedger(old, '2026-09-19', false)).toBe(old);
  });
});

describe('what the sheet shows', () => {
  const many = [
    E('a', '2026-09-10'), E('b', '2026-09-12'), E('c', '2026-09-14'), E('d', '2026-09-16'),
  ];
  const ledger = { seen: [], since: WHATS_NEW_EPOCH };

  it('is the newest three, never four', () => {
    expect(recentEntries(many).map((e) => e.slug)).toEqual(['d', 'c', 'b']);
    expect(recentEntries(many)).toHaveLength(WHATS_NEW_MAX_ROWS);
  });

  it('is sorted here, not trusted from the file', () => {
    const shuffled = [E('old', '2026-01-01'), E('new', '2026-09-19')];
    expect(recentEntries(shuffled).map((e) => e.slug)).toEqual(['new', 'old']);
  });

  it('opens by itself only for entries not yet spent', () => {
    const after = markSeen(ledger, ['d']);
    expect(unseenEntries(many, after).map((e) => e.slug)).toEqual(['c', 'b']);
  });

  it('still lists what was read when it is opened on purpose', () => {
    // Rule 3: a recallable list that hid everything you had read would be an empty
    // screen for exactly the people who came looking.
    const after = markSeen(ledger, ['d', 'c', 'b']);
    expect(unseenEntries(many, after)).toEqual([]);
    expect(visibleEntries(many, after).map((e) => e.slug)).toEqual(['d', 'c', 'b']);
  });

  it('never re-announces a slug, however many times it is spent', () => {
    const once = markSeen(ledger, ['d']);
    expect(markSeen(once, ['d']).seen).toEqual(['d']);
  });
});

describe('the entries file', () => {
  it('has a unique, stable slug per entry', () => {
    const slugs = WHATS_NEW.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('is written in both languages, so nothing ships half-translated', () => {
    for (const e of WHATS_NEW) {
      for (const lang of WHATS_NEW_LANGS) {
        expect(e[lang].title, `${e.slug}.${lang}.title`).toBeTruthy();
        expect(e[lang].body, `${e.slug}.${lang}.body`).toBeTruthy();
      }
      expect(/^\d{4}-\d{2}-\d{2}$/.test(e.publishedAt), `${e.slug}.publishedAt`).toBe(true);
      // A row that goes nowhere is an OK button wearing a chevron.
      expect(e.href.startsWith('/'), `${e.slug}.href`).toBe(true);
    }
  });

  it('points every row at a page that exists', () => {
    // `/program` shipped here once and is a 404 — the real route is
    // `/dashboard/program`. A dead href is invisible until someone taps it.
    for (const e of WHATS_NEW) {
      const dir = join(SRC, 'app/(app)', e.href);
      expect(existsSync(join(dir, 'page.tsx')), `${e.slug} → ${e.href}`).toBe(true);
    }
  });

  it('never sends a reader from the feed back to the feed', () => {
    // The sheet opens ON the feed. A row pointing at /feed closes the sheet and
    // changes nothing, which reads as broken even though it navigated.
    for (const e of WHATS_NEW) {
      expect(e.href, `${e.slug}.href`).not.toBe('/feed');
    }
  });

  it('keeps Hebrew out of the English copy', () => {
    const hebrew = /[֐-׿]/;
    for (const e of WHATS_NEW) {
      expect(hebrew.test(JSON.stringify(e.en)), `${e.slug}.en`).toBe(false);
    }
  });
});

describe('the sheet component', () => {
  const sheet = read('components/whats-new/WhatsNewSheet.tsx');

  it('never opens on a cold paint — the feed decides when it has painted', () => {
    expect(sheet).toMatch(/\{ ready \}: \{ ready: boolean \}/);
    expect(sheet).toMatch(/if \(!ready \|\| entries\) return;/);
    const feed = read('app/(app)/feed/page.tsx');
    expect(feed).toMatch(/<WhatsNewAutoSheet ready=\{!loading && !error && items\.length > 0\} \/>/);
  });

  it('spends the slugs when it opens, not when it closes', () => {
    const open = sheet.indexOf('setOpen(true)');
    expect(sheet.indexOf('markSeen(ledger')).toBeGreaterThan(-1);
    expect(sheet.indexOf('markSeen(ledger')).toBeLessThan(open);
  });

  it('sends every row into its feature instead of just closing', () => {
    expect(sheet).toMatch(/<Link\s+href=\{entry\.href\}/);
  });

  it('navigates with a real anchor, because router.push here gets cancelled', () => {
    // lib/use-back-dismiss.ts only learns a navigation is coming by seeing the
    // click land inside `a[href]`; from a <button> it pops the sheet's history
    // entry on close and the push never lands. That was the 2.40.91 dead row.
    expect(sheet).not.toMatch(/from 'next\/navigation'|router\.push\(/);
    expect(sheet).toMatch(/import Link from 'next\/link'/);
  });

  it('is recallable from settings, and reopening it spends nothing', () => {
    expect(sheet).toMatch(/export function WhatsNewSettingsRow/);
    const row = sheet.slice(sheet.indexOf('export function WhatsNewSettingsRow'));
    expect(row).not.toMatch(/markSeen/);
    const settings = read('app/(app)/dashboard/settings/page.tsx');
    expect(settings).toMatch(/<WhatsNewSettingsRow \/>/);
  });

  it('keeps the timing rules in the ledger rather than restating them', () => {
    expect(sheet).toMatch(/unseenEntries\(WHATS_NEW, ledger\)/);
    expect(sheet).not.toMatch(/MAX_ROWS =|EPOCH =|setTimeout/);
  });

  it('stores its state under one key, per device', () => {
    expect(WHATS_NEW_KEY).toBe('mc:whatsNew');
    expect(sheet).not.toMatch(/sessionStorage/);
  });
});

describe('the sheet has its labels in both catalogues', () => {
  it('has he/en parity', () => {
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const wn = JSON.parse(read(f)).whatsNew;
      for (const k of ['title', 'lead', 'badge', 'gotIt', 'recall']) {
        expect(wn?.[k], `${f}.${k}`).toBeTruthy();
      }
    }
  });
});
