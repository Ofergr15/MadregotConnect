import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { WHATS_NEW, WHATS_NEW_LANGS } from '@/lib/whats-new/entries';
import {
  EVENING_ENTRIES, EVENING_EXTRA, EVENING_MORE, EVENING_SINCE, composeWhatsNew,
} from '@/lib/whats-new/evening';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const note = (id: string, o: Partial<ShownNote> = {}): ShownNote => ({
  id, date: '2026-09-30', kind: 'fix', icon: '🔧', title: id, body: `${id} body`, featured: false, edited: false, ...o,
});
/** The notes part of "and more"; the written extras always follow it. */
const notesOf = (more: ShownNote[]) => more.map(n => n.id).filter(id => !EVENING_EXTRA.some(x => x.id === id));
const release = (app_version: string, notes: ShownNote[], id = 1): WhatsNewRelease => ({
  id, released_at: '2026-09-30T17:00:00Z', app_version, notes,
});

describe('composeWhatsNew', () => {
  it('before the evening is exactly the sheet it always was', () => {
    const c = composeWhatsNew([release('2.41.70', [note('a', { featured: true }), note('b')])], '2.41.70', false);
    expect(c.entries.map(e => e.slug)).toEqual([...WHATS_NEW.map(e => e.slug), 'release:a']);
    expect(c.more).toEqual([]);
  });

  it('with it, the two headlines lead and the old hand-written rows step aside', () => {
    const c = composeWhatsNew([], '2.41.70', true);
    expect(c.entries.map(e => e.slug)).toEqual(['share-editor-2026-09', 'week-editor-2026-09', 'academy-2026-09']);
  });

  it('lists exactly his picks under them, in his order, once each', () => {
    const [a, b, c] = EVENING_MORE;
    const got = composeWhatsNew([
      release('2.41.60', [note(c), note('not-picked'), note(a)], 1),
      release('2.41.70', [note(b), note(a)], 2),
    ], '2.41.70', true);
    expect(notesOf(got.more)).toEqual([a, b, c]);
  });

  it('leaves out staff notes and starred notes even when picked', () => {
    const [a, b, c] = EVENING_MORE;
    const got = composeWhatsNew([release('2.41.70', [
      note(a, { audience: 'staff' }),
      note(b, { featured: true }),
      note(c),
    ])], '2.41.70', true);
    expect(notesOf(got.more)).toEqual([c]);
    // A starred note the headlines do not cover still gets its own row.
    expect(got.entries.map(e => e.slug)).toContain(`release:${b}`);
  });

  it('picks only notes that exist and that members may see', async () => {
    const { BUNDLED_NOTES } = await import('@/lib/release-notes');
    for (const id of EVENING_MORE) {
      const n = [...BUNDLED_NOTES, ...EVENING_EXTRA].find(x => x.id === id);
      expect(n, id).toBeTruthy();
      expect(n!.audience, id).not.toBe('staff');
    }
  });

  it('never announces a release newer than the bundle', () => {
    expect(notesOf(composeWhatsNew([release('2.41.71', [note('later')])], '2.41.70', true).more)).toEqual([]);
  });

  it('ends the list with every written extra, after his picks', () => {
    const got = composeWhatsNew([], '2.41.70', true).more.map(n => n.id);
    expect(got).toEqual(EVENING_EXTRA.map(x => x.id));
    expect(EVENING_EXTRA.every(x => EVENING_MORE.includes(x.id))).toBe(true);
  });

  it('starts the list the day after the last hand-written entry', () => {
    const last = WHATS_NEW.map(e => e.publishedAt).sort().at(-1)!;
    expect(EVENING_SINCE > last).toBe(true);
  });
});

describe('the headline entries', () => {
  it('are complete in both languages, button included, with no Hebrew in the English', () => {
    for (const e of EVENING_ENTRIES) {
      for (const lang of WHATS_NEW_LANGS) {
        expect(e[lang].title && e[lang].body && e[lang].cta && e[lang].kicker && e[lang].where, `${e.slug}.${lang}`).toBeTruthy();
      }
      expect(/[֐-׿]/.test(JSON.stringify(e.en) + e.cards!.map(f => f.en).join('')), e.slug).toBe(false);
    }
  });

  it('draw every frame from a real render on disk, in both languages', () => {
    for (const e of EVENING_ENTRIES) {
      expect(e.cards!.length).toBeGreaterThan(1);
      for (const f of e.cards!) {
        for (const lang of WHATS_NEW_LANGS) {
          expect(existsSync(join(SRC, '..', 'public/whats-new', `${f.key}.${lang}.jpg`)), `${f.key}.${lang}`).toBe(true);
        }
      }
    }
  });

  it('each show their editor at work, on captures that exist, tapped on the screen', () => {
    for (const e of EVENING_ENTRIES.filter(x => x.slug !== 'academy-2026-09')) {
      const d = e.demo!;
      expect(d.steps.length, e.slug).toBeGreaterThan(3);
      for (const key of [d.first, ...d.steps.map(x => x.key)]) {
        expect(existsSync(join(SRC, '..', 'public/whats-new/edit', `${key}.jpg`)), key).toBe(true);
      }
      for (const x of d.steps) {
        expect(x.x > 0 && x.x < 390 && x.y > 0 && x.y < 844, x.key).toBe(true);
        expect(x.he && x.en && !/[֐-׿]/.test(x.en), x.key).toBeTruthy();
      }
      for (const lang of WHATS_NEW_LANGS) {
        expect(d[lang].title && d[lang].body && d[lang].cta && d[lang].kicker && d[lang].where, `${e.slug}.demo.${lang}`).toBeTruthy();
      }
      expect(/[֐-׿]/.test(JSON.stringify(d.en)), e.slug).toBe(false);
    }
  });

  it('send their button to a page that exists', () => {
    for (const e of EVENING_ENTRIES) {
      const path = e.href.split('?')[0];
      const found = ['app/(app)', 'app'].some(dir => existsSync(join(SRC, dir, path, 'page.tsx')));
      expect(found, e.href).toBe(true);
    }
    expect(EVENING_ENTRIES.map(e => e.href)).toEqual(['/dashboard/share?what=run', '/dashboard/share?what=week', '/academy']);
  });
});

describe('the switch', () => {
  it('keeps the feed’s auto-open off until it is flipped, the super user included', () => {
    const sheet = read('components/whats-new/WhatsNewSheet.tsx');
    const auto = sheet.slice(sheet.indexOf('export function WhatsNewAutoSheet'), sheet.indexOf('export function WhatsNewSettingsRow'));
    expect(auto).toMatch(/useContent\(EVENING_OPEN\)/);
    expect(auto).not.toMatch(/useEveningRelease/);
  });

  it('is what opens both editors and the week-before comparison', () => {
    expect(read('components/ShareSheet.tsx')).toMatch(/const editor = useEveningRelease\(\);/);
    expect(read('components/feed/WeekSummaryCard.tsx')).toMatch(/const trial = useEveningRelease\(\);/);
  });

  it('shows the rehearsal what the evening composes, as the tour', () => {
    const page = read('app/(app)/dashboard/release-rehearsal/page.tsx');
    expect(page).toMatch(/composeWhatsNew\(/);
    expect(page).toMatch(/<WhatsNewStory /);
  });

  it('opens the headlines as the full-screen tour, and Settings can replay it', () => {
    const sheet = read('components/whats-new/WhatsNewSheet.tsx');
    const auto = sheet.slice(sheet.indexOf('export function WhatsNewAutoSheet'), sheet.indexOf('export function WhatsNewSettingsRow'));
    expect(auto).toMatch(/<WhatsNewStory /);
    expect(sheet.slice(sheet.indexOf('export function WhatsNewSettingsRow'))).toMatch(/onReplay=/);
  });

  it('turns pages as a story does: two halves of the whole screen, and a hold pauses', () => {
    const story = read('components/whats-new/WhatsNewStory.tsx');
    expect(story).toMatch(/zone\(prev, t\('tourBack'\), 'start-0'\)/);
    expect(story).toMatch(/zone\(next, t\('tourNext'\), 'end-0'\)/);
    expect(story).toMatch(/if \(!held\.current\) ran \+=/);
  });

  it('keeps the tour’s buttons real links inside a dialog, which the rehearsal catches', () => {
    const story = read('components/whats-new/WhatsNewStory.tsx');
    expect(story).toMatch(/role="dialog"/);
    expect(story).toMatch(/<Link\s+href=\{entry\.href\}/);
  });
});

describe('the notes members see', () => {
  it('keep the academy and the admin screens to staff', async () => {
    const { BUNDLED_NOTES } = await import('@/lib/release-notes');
    const leaked = BUNDLED_NOTES.filter(n => n.date >= EVENING_SINCE && n.audience !== 'staff'
      && (n.id.startsWith('academy-') || ['approve-needs-pack', 'approvals-academy-split', 'role-switcher'].includes(n.id)));
    expect(leaked.map(n => n.id)).toEqual([]);
  });
});
