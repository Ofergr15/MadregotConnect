import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { WHATS_NEW, WHATS_NEW_LANGS } from '@/lib/whats-new/entries';
import {
  EVENING_DATE, EVENING_ENTRIES, EVENING_EXTRA, EVENING_MORE, EVENING_SINCE, RELEASE_OPEN, TOUR_PARAM, composeWhatsNew,
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

  it('with it, the five club headlines lead, in order, and the old hand-written rows step aside', () => {
    const c = composeWhatsNew([], '2.41.70', true, false, true);
    expect(c.entries.map(e => e.slug)).toEqual(['b18-run-page', 'b18-profile', 'b18-records', 'b18-fitness', 'b18-photos']);
  });

  it('until RELEASE_OPEN, is the super user\'s only: a member composes as before the evening', () => {
    expect(RELEASE_OPEN).toBe(false);
    const member = composeWhatsNew([], '2.41.70', true);
    expect(member.entries.map(e => e.slug)).toEqual(WHATS_NEW.map(e => e.slug));
    expect(member.more).toEqual([]);
  });

  it('gives staff the same five first, then theirs', () => {
    const c = composeWhatsNew([], '2.41.70', true, true, true);
    expect(c.entries.map(e => e.slug)).toEqual([
      'b18-run-page', 'b18-profile', 'b18-records', 'b18-fitness', 'b18-photos',
      'b18-management', 'b18-publish', 'b18-social', 'b18-watch-send',
    ]);
  });

  it('has no academy page: it is not open yet', () => {
    expect(JSON.stringify(EVENING_ENTRIES)).not.toMatch(/academy/i);
  });

  it('dates every headline by the one release date', () => {
    expect(new Set(EVENING_ENTRIES.map(e => e.publishedAt))).toEqual(new Set([EVENING_DATE]));
  });

  it('lists the club notes for members, and the staff ones after them for staff', () => {
    const member = composeWhatsNew([], '2.41.70', true, false, true).more.map(n => n.id);
    const staff = composeWhatsNew([], '2.41.70', true, true, true).more.map(n => n.id);
    expect(member).toEqual(EVENING_EXTRA.filter(x => x.audience !== 'staff').map(x => x.id));
    expect(staff).toEqual(EVENING_MORE.filter(id => EVENING_EXTRA.some(x => x.id === id)));
    expect(staff.slice(0, member.length)).toEqual(member);
  });

  it('leaves out staff release notes and starred notes even when picked', () => {
    const got = composeWhatsNew([release('2.41.70', [
      note('picked-staff', { audience: 'staff' }),
      note('picked-star', { featured: true }),
    ])], '2.41.70', true, false, true);
    expect(notesOf(got.more)).toEqual([]);
    // A starred note the headlines do not cover still gets its own row.
    expect(got.entries.map(e => e.slug)).toContain('release:picked-star');
  });

  it('picks only notes that exist', async () => {
    const { BUNDLED_NOTES } = await import('@/lib/release-notes');
    for (const id of EVENING_MORE) expect([...BUNDLED_NOTES, ...EVENING_EXTRA].find(x => x.id === id), id).toBeTruthy();
    expect(EVENING_EXTRA.every(x => EVENING_MORE.includes(x.id))).toBe(true);
  });

  it('never announces a release newer than the bundle', () => {
    expect(notesOf(composeWhatsNew([release('2.41.71', [note('later')])], '2.41.70', true, false, true).more)).toEqual([]);
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
      expect(e.cards!.length, e.slug).toBeGreaterThan(0);
      for (const f of e.cards!) {
        for (const lang of WHATS_NEW_LANGS) {
          expect(existsSync(join(SRC, '..', 'public/whats-new', `${f.key}.${lang}.jpg`)), `${f.key}.${lang}`).toBe(true);
        }
      }
    }
  });

  it('show their editor at work only on captures that exist, tapped on the screen', () => {
    for (const e of EVENING_ENTRIES.filter(x => x.demo)) {
      const d = e.demo!;
      for (const key of [d.first, ...d.steps.map(x => x.key)]) {
        expect(existsSync(join(SRC, '..', 'public/whats-new/edit', `${key}.jpg`)), key).toBe(true);
      }
      for (const x of d.steps) expect(x.x > 0 && x.x < 390 && x.y > 0 && x.y < 844, x.key).toBe(true);
    }
  });

  it('send their button to a page that exists', () => {
    for (const e of EVENING_ENTRIES) {
      const path = e.href.split('?')[0];
      const found = ['app/(app)', 'app'].some(dir => existsSync(join(SRC, dir, path, 'page.tsx')));
      expect(found, e.href).toBe(true);
    }
  });
});

describe('the release push link', () => {
  it('opens the tour on any device, only once the switch is on, and drops itself from the address', () => {
    expect(TOUR_PARAM).toBe('tour');
    const sheet = read('components/whats-new/WhatsNewSheet.tsx');
    const auto = sheet.slice(sheet.indexOf('export function WhatsNewAutoSheet'), sheet.indexOf('export function WhatsNewSettingsRow'));
    expect(auto).toMatch(/const asked = EVENING_OPEN && TOUR_VALUES\.includes\(url\.searchParams\.get\(TOUR_PARAM\) \?\? ''\);/);
    expect(auto).toMatch(/asked\s*\? visibleEntries\(all, \{ \.\.\.ledger, since: WHATS_NEW_EPOCH \}\)\s*: unseenEntries\(all, ledger\)/);
    expect(auto).toMatch(/url\.searchParams\.delete\(TOUR_PARAM\)/);
    // still spent at open, and never inside the rehearsal's frame
    expect(auto.indexOf('isFramed()')).toBeLessThan(auto.indexOf('const asked'));
    expect(auto).toMatch(/markSeen\(ledger, next\.map/);
  });
});

describe('the composer', () => {
  it('can send a broadcast whose tap opens the tour, only once the release is out', () => {
    const nc = read('components/NotificationCenter.tsx');
    expect(nc).toMatch(/\.\.\.\(EVENING_OPEN && opens === 'tour' \? \{ url: `\/feed\?\$\{TOUR_PARAM\}=\$\{TOUR_VALUE\}` \} : \{\}\)/);
    expect(nc).toMatch(/composeMode === 'message' && EVENING_OPEN && \(/);
    expect(nc).toMatch(/setOpens\('app'\)/);
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
