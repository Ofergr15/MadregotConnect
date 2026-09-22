import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * A HALF-FILLED SPONSOR PERK.
 *
 * His report: "I'd put the Wellness logo into partnerships, and add a discount
 * code to some of them for the websites." Nothing was broken — the athlete screen
 * has rendered a copyable code and a sponsor button since migration 066, and the
 * admin form has had both fields all along. What was true is that all thirteen
 * live perks were saved without either, and one of them (וולנס) without a logo,
 * and neither screen said so: a half-filled perk looked exactly like a finished
 * one in the manager, and on the member's grid it looked broken.
 *
 * So these pin the two things that make an empty field visible rather than
 * re-testing the fields themselves.
 */

describe('a sponsor with no logo', () => {
  const page = read('app/(app)/dashboard/benefits/page.tsx');

  it('falls back to the sponsor NAME, not a generic gift icon', () => {
    expect(page).toMatch(/function SponsorMark\(/);
    // The gift icon survives for the empty STATE, which is a different thing:
    // no perks at all, rather than a perk with no logo.
    expect(page).toMatch(/EmptyState icon=\{Gift\}/);
    expect(page).not.toMatch(/<Gift className="h-9 w-9/);
    expect(page).not.toMatch(/<Gift className="h-10 w-10/);
  });

  it('uses the same mark on the grid tile and in the sheet', () => {
    expect(page.match(/<SponsorMark /g)).toHaveLength(2);
    expect(page).toMatch(/size="card"/);
    expect(page).toMatch(/size="sheet"/);
  });

  it('lets a Hebrew sponsor name set itself the right way round', () => {
    // HOKA and SAYSKY are Latin, וולנס is Hebrew, and the tile is one component.
    const mark = page.slice(page.indexOf('function SponsorMark'), page.indexOf('export default'));
    expect(mark).toMatch(/dir="auto"/);
    // And a long name wraps inside the tile instead of pushing out of it.
    expect(mark).toMatch(/break-words/);
  });
});

describe('the perks manager', () => {
  const mgr = read('components/PerksManager.tsx');

  it('names what a perk is still missing, on the row', () => {
    expect(mgr).toMatch(/function missingOn\(/);
    expect(mgr).toMatch(/if \(!p\.imageUrl\)/);
    expect(mgr).toMatch(/if \(!p\.discountCode\)/);
    expect(mgr).toMatch(/if \(!p\.redeemUrl\)/);
  });

  it('says nothing at all about a perk that has all three', () => {
    expect(mgr).toMatch(/missingOn\(p, t\)\.length > 0 && \(/);
  });

  it('flags only the fields the member\'s screen reacts to', () => {
    const fn = mgr.slice(mgr.indexOf('function missingOn'), mgr.indexOf('/**\n * Settings'));
    // Titles are required to save, so they can never be missing, and `tier`
    // always has a value — flagging either would be noise on every row.
    expect(fn).not.toMatch(/titleHe|titleEn|tier/);
  });

  it('has the labels in both languages', () => {
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const m = JSON.parse(read(f)).perksManager;
      for (const k of ['missingPrefix', 'missingLogo', 'missingCode', 'missingLink']) {
        expect(m[k], `${f} ${k}`).toBeTruthy();
      }
    }
  });
});
