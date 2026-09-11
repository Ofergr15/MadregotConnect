import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasNonLatinLetters,
  isPlaceholderRosterName,
  nameProblem,
  normalizeDisplayName,
  rosterNameFromProvider,
} from '@/lib/names/latin';

/**
 * Every case below is a row that was actually on prod on 2026-09-11: six names in
 * Hebrew, two lower-cased, one with a trailing space. The cleanup was hand-written
 * SQL; these tests are the half that stops it being needed again.
 */

const root = join(__dirname, '..', '..');

describe('normalizeDisplayName', () => {
  it('takes off the whitespace prod actually had', () => {
    // One roster row was stored as 'רן אלתרמן ' — with a trailing space — which is
    // why the cleanup SQL had to key on id: a WHERE name = '…' matched nothing.
    expect(normalizeDisplayName('Ran Alterman ')).toBe('Ran Alterman');
    expect(normalizeDisplayName('  Roy   Roth  ')).toBe('Roy Roth');
  });

  it('capitalises what the member left lower-case', () => {
    expect(normalizeDisplayName('tarkin adago')).toBe('Tarkin Adago');
    expect(normalizeDisplayName('yair Gabbay')).toBe('Yair Gabbay');
  });

  it('capitalises across hyphens and apostrophes', () => {
    expect(normalizeDisplayName('ido bar-on')).toBe('Ido Bar-On');
    expect(normalizeDisplayName("sean o'neill")).toBe("Sean O'Neill");
  });

  it('leaves a word that already carries a capital alone', () => {
    // The member knows their own spelling better than the rule does; forcing title
    // case is how 'McDonald' becomes 'Mcdonald'.
    expect(normalizeDisplayName('Ewan McDonald')).toBe('Ewan McDonald');
    expect(normalizeDisplayName('Ido Bar-On')).toBe('Ido Bar-On');
  });

  it('handles nothing at all without throwing', () => {
    expect(normalizeDisplayName('   ')).toBe('');
    expect(normalizeDisplayName(null)).toBe('');
    expect(normalizeDisplayName(undefined)).toBe('');
  });
});

describe('hasNonLatinLetters', () => {
  it('catches the scripts a roster row could arrive in', () => {
    expect(hasNonLatinLetters('רועי רוט')).toBe(true); // Hebrew
    expect(hasNonLatinLetters('Иван')).toBe(true); // Cyrillic
    expect(hasNonLatinLetters('Roy רוט')).toBe(true); // one word of each
  });

  it('accepts Latin, including accents and punctuation', () => {
    expect(hasNonLatinLetters('Roy Roth')).toBe(false);
    expect(hasNonLatinLetters('Zoë Bär-Ilan')).toBe(false);
    expect(hasNonLatinLetters('Taly (designer)')).toBe(false);
  });
});

describe('nameProblem', () => {
  it('separates "empty" from "not English", because the ask differs', () => {
    expect(nameProblem('Roy Roth')).toBeNull();
    expect(nameProblem('   ')).toBe('empty');
    expect(nameProblem('רועי רוט')).toBe('not-latin');
  });

  it('treats a name with no letters as not English', () => {
    // There is no separate message worth writing for '123' — "please use English
    // letters" is true advice for it too.
    expect(nameProblem('12345')).toBe('not-latin');
    expect(nameProblem('---')).toBe('not-latin');
  });
});

describe('rosterNameFromProvider', () => {
  it('lets Strava keep owning the name, normalised', () => {
    expect(rosterNameFromProvider('roy roth', 'Roy R')).toBe('Roy Roth');
    expect(rosterNameFromProvider('Yosi Sabag', 'Strava 659081577')).toBe('Yosi Sabag');
  });

  it('refuses to revert a corrected roster name to Hebrew', () => {
    // The regression this exists for: six names were fixed by hand on the roster,
    // and this write ran on EVERY Strava login. Unbounded, each of them would have
    // gone back to Hebrew within a day of the cleanup.
    expect(rosterNameFromProvider('רועי רוט', 'Roy Roth')).toBeNull();
    expect(rosterNameFromProvider('אסף אלקסלסי', 'Asaf Elkeslassy')).toBeNull();
  });

  it('still takes a Hebrew name when the row has nothing better', () => {
    // A real name in Hebrew beats a placeholder this app wrote for itself, and
    // beats a worse Hebrew name. Asking them to write it in English is the profile
    // screen's job, not a silent rewrite's.
    expect(rosterNameFromProvider('רועי רוט', 'רועי')).toBe('רועי רוט');
    expect(rosterNameFromProvider('רועי רוט', null)).toBe('רועי רוט');
    expect(rosterNameFromProvider('רועי רוט', 'Strava 12345', true)).toBe('רועי רוט');
  });

  it('needs to be TOLD a name is a placeholder before overwriting it', () => {
    // 'Strava 12345' is Latin, so the default rule protects it. The caller knows
    // whether it is a placeholder (isPlaceholderRosterName) and says so.
    expect(rosterNameFromProvider('רועי רוט', 'Strava 12345')).toBeNull();
  });

  it('writes nothing when there is nothing to change', () => {
    expect(rosterNameFromProvider(null, 'Roy Roth')).toBeNull();
    expect(rosterNameFromProvider('  ', 'Roy Roth')).toBeNull();
    // Already correct: no write, so a login is not a no-op UPDATE per member.
    expect(rosterNameFromProvider('Roy Roth', 'Roy Roth')).toBeNull();
    expect(rosterNameFromProvider('Roy Roth ', 'Roy Roth')).toBeNull();
  });
});

describe('isPlaceholderRosterName', () => {
  it('recognises both shapes the app invents', () => {
    expect(isPlaceholderRosterName('Strava 659081577', null)).toBe(true);
    expect(isPlaceholderRosterName('Grosfeldofer', 'grosfeldofer@gmail.com')).toBe(true);
    expect(isPlaceholderRosterName('', 'roy.m.roth@gmail.com')).toBe(true);
  });

  it('does not mistake a real name for one', () => {
    expect(isPlaceholderRosterName('Roy Roth', 'roy.m.roth@gmail.com')).toBe(false);
    expect(isPlaceholderRosterName('רועי רוט', 'roy.m.roth@gmail.com')).toBe(false);
    // Not a placeholder shape: 'Strava' with no id is somebody's actual surname
    // somewhere, and we only claim the exact generated form.
    expect(isPlaceholderRosterName('Strava', null)).toBe(false);
  });
});

describe('the intake paths', () => {
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('validates the name in all three places a human supplies one', () => {
    // Profile edit, the public academy form, and that form's API. Each one is a
    // door onto athletes.name; a rule enforced at two of three is not a rule.
    expect(read('src/app/api/athletes/me/route.ts')).toContain('nameProblem(name)');
    expect(read('src/components/PersonalInfo.tsx')).toContain('nameProblem(name)');
    expect(read('src/app/api/academy/register/route.ts')).toContain("nameProblem(name) === 'not-latin'");
    expect(read('src/app/academy-register/page.tsx')).toContain("nameProblem(values[key]) === 'not-latin'");
  });

  it('no longer writes a Strava name onto the roster unconditionally', () => {
    const callback = read('src/app/api/strava/callback/route.ts');
    expect(callback).not.toContain('{ name: stravaDisplayName }');
    expect(callback.match(/rosterNameFromProvider\(/g)?.length).toBe(2);
  });
});
