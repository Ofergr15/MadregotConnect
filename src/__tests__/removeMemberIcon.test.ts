import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * "לשנות סימן של מחיקה" — the delete icon on the entry queue.
 *
 * The screenshot was a member card in "מחכים להיכנס" whose action row ended in a
 * red person-with-a-minus (lucide `UserMinus`). Two things were wrong with it,
 * and neither is a matter of taste:
 *
 * 1. That exact glyph is what THIS SAME SCREEN uses as the STATUS marker for
 *    somebody already out of the club — it is the avatar placeholder on every row
 *    of the "removed" list, and it is the badge on dashboard/athletes. So the
 *    destructive action and the state it produces were drawn identically, a few
 *    hundred pixels apart, on one screen.
 * 2. A person-with-a-minus reads as "unfollow" / "take out of my group", which is
 *    exactly the softer thing a reader assumes it means. The button removes a
 *    member from the club.
 *
 * Every other destructive action in the app already uses `Trash2` (athletes,
 * settings, badges, perks, challenges, store, feed items, comments). This was the
 * outlier, so the fix is to stop being one — including on the confirm button, so
 * the second tap is visibly the same action rather than a new one.
 */

const page = readFileSync(
  new URL('../app/(app)/dashboard/entry-queue/page.tsx', import.meta.url),
  'utf8',
);

describe('remove-from-club uses the bin', () => {
  it('the trigger is Trash2', () => {
    expect(page).toMatch(/aria-label=\{t\('removeFromClub'\)\}[\s\S]{0,80}<Trash2/);
  });

  it('the confirm button repeats the same glyph', () => {
    // A different icon on the confirm would read as a second, different action —
    // the one thing a two-tap destructive flow cannot afford.
    expect(page).toMatch(/variant="danger"[\s\S]{0,220}<Trash2/);
  });

  it('the trigger says what it does, for a screen reader and on hover', () => {
    // It is an icon-only ghost button; without both of these it announced itself
    // as "button" and nothing else.
    expect(page).toContain("title={t('removeFromClub')}");
    expect(page).toContain("aria-label={t('removeFromClub')}");
  });

  it('UserMinus survives only as the status marker it always was', () => {
    // Kept on purpose: the avatar slot of an already-removed member. Deleting it
    // would be over-correcting — the glyph was never wrong as a STATE, only as an
    // ACTION. This asserts the split holds: no UserMinus inside a Button.
    expect(page).toContain('<UserMinus className="h-4 w-4 text-ink-400" />');
    expect(page).not.toMatch(/<Button[\s\S]{0,200}<UserMinus/);
  });
});

describe('the label the icon replaced', () => {
  it('exists in both locales', () => {
    for (const locale of ['he', 'en']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'),
      );
      expect(typeof messages.entryQueue.removeFromClub).toBe('string');
    }
  });
});
