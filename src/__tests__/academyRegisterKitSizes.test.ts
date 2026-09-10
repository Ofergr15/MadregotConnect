import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The academy intake form and the coach-facing view of it are two files that have to
 * agree, and nothing connects them: the form writes free-form keys into the
 * `academy_intake` JSON blob, and AcademIntake renders `LABELS[k] || k` — so a field
 * added to the form and not to the map shows the coach the literal string
 * `socksSize`. No type, no test and no build step notices.
 *
 * Source assertions rather than a render: FIELDS and LABELS are module-private
 * consts in a 'use client' page, and importing the page to reach them drags in the
 * whole UI kit for what is really a two-list comparison.
 */

const root = join(__dirname, '..', '..');
const form = readFileSync(join(root, 'src/app/academy-register/page.tsx'), 'utf8');
const queue = readFileSync(join(root, 'src/components/AcademyRegistrations.tsx'), 'utf8');

/** The FIELDS array literal alone — the `Field` union above it names the same
 *  strings, so counting anything across the whole file counts it twice. */
const fields = form.slice(form.indexOf('const FIELDS'), form.indexOf('REGISTRATION_OPEN'));

/** Every `key: '…'` inside the FIELDS array literal. */
function formKeys(): string[] {
  return [...fields.matchAll(/\bkey:\s*'([^']+)'/g)].map(m => m[1]);
}

/** Every key of the LABELS map in the coach view. */
function labelKeys(): string[] {
  const block = queue.slice(queue.indexOf('const LABELS'), queue.indexOf('function initialsOf'));
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
}

describe('academy registration kit sizes', () => {
  it('asks for all four kit sizes', () => {
    const keys = formKeys();
    for (const k of ['shirtSize', 'pantsSize', 'tightsSize', 'socksSize']) {
      expect(keys, `${k} is missing from the form`).toContain(k);
    }
  });

  it('renders the size questions as chips, not four stacked radio lists', () => {
    // Six sizes x four questions as radios is twenty-four rows, which pushes the
    // medical and goal questions off the first screen on a phone.
    expect(fields.match(/type: 'chips'/g)?.length).toBe(4);
    expect(form).toContain("f.type === 'chips'");
  });

  it('shares one clothing-size list so the three garment questions cannot drift', () => {
    const garments = ['shirtSize', 'pantsSize', 'tightsSize'];
    for (const k of garments) {
      const line = form.split('\n').find(l => l.includes(`key: '${k}'`));
      expect(line, `${k} is missing`).toBeTruthy();
      expect(line, `${k} spells its options out instead of using CLOTHING_SIZES`).toContain('CLOTHING_SIZES');
    }
    // Socks are sized off the shoe, so they are deliberately a different list.
    const socks = form.split('\n').find(l => l.includes("key: 'socksSize'"));
    expect(socks).toContain('SOCK_SIZES');
  });

  it("pills are type=button, so picking a size cannot submit the form", () => {
    // lastIndexOf for the closing bound: the required-check loop near the top of
    // the component tests `f.type === 'checkboxes'` too, and that one comes FIRST.
    const chips = form.slice(form.indexOf("f.type === 'chips'"), form.lastIndexOf("f.type === 'checkboxes'"));
    expect(chips).toContain('type="button"');
    expect(chips).toContain('aria-pressed');
  });

  it('gives every intake field a Hebrew label in the coach view', () => {
    const labels = labelKeys();
    // email/phone are lifted into columns and shown in the card header instead.
    const lifted = new Set(['email', 'phone']);
    const missing = formKeys().filter(k => !lifted.has(k) && !labels.includes(k));
    expect(missing, `these would render as raw keys to the coach: ${missing.join(', ')}`).toEqual([]);
  });
});
