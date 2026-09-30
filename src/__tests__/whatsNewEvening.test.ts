import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { WHATS_NEW, WHATS_NEW_LANGS } from '@/lib/whats-new/entries';
import {
  EVENING_ENTRIES, EVENING_FOLDED, EVENING_SINCE, composeWhatsNew,
} from '@/lib/whats-new/evening';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const note = (id: string, o: Partial<ShownNote> = {}): ShownNote => ({
  id, date: '2026-09-30', kind: 'fix', icon: '🔧', title: id, body: `${id} body`, featured: false, edited: false, ...o,
});
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
    expect(c.entries.map(e => e.slug)).toEqual(['share-editor-2026-09', 'week-editor-2026-09']);
  });

  it('lists everything else under them, newest first, once each', () => {
    const c = composeWhatsNew([
      release('2.41.60', [note('old', { date: '2026-09-23' }), note('twice', { date: '2026-09-29' })], 1),
      release('2.41.70', [note('new'), note('twice', { date: '2026-09-29' })], 2),
    ], '2.41.70', true);
    expect(c.more.map(n => n.id)).toEqual(['new', 'twice', 'old']);
  });

  it('leaves out what the headlines say, staff notes, starred notes and anything before the floor', () => {
    const c = composeWhatsNew([release('2.41.70', [
      note(EVENING_FOLDED[0]),
      note('admin', { audience: 'staff' }),
      note('starred', { featured: true }),
      note('ancient', { date: '2026-09-10' }),
      note('kept'),
    ])], '2.41.70', true);
    expect(c.more.map(n => n.id)).toEqual(['kept']);
    // A starred note the headlines do not cover still gets its own row.
    expect(c.entries.map(e => e.slug)).toContain('release:starred');
  });

  it('never announces a release newer than the bundle', () => {
    expect(composeWhatsNew([release('2.41.71', [note('later')])], '2.41.70', true).more).toEqual([]);
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

  it('send their button to a page that exists', () => {
    for (const e of EVENING_ENTRIES) {
      const path = e.href.split('?')[0];
      expect(existsSync(join(SRC, 'app/(app)', path, 'page.tsx')), e.href).toBe(true);
    }
    expect(EVENING_ENTRIES.map(e => e.href)).toEqual(['/dashboard/share?what=run', '/dashboard/share?what=week']);
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
