import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import {
  STAGE, UPDATE_BOOT_SCRIPT, UPDATING_KEY, UPDATING_TTL_MS, isMidTyping, landedOnNewBuild,
  onlyTheWorkerIsOld, readUpdatingNote, seenSlugs, updateContent, writeUpdatingNote,
} from '@/lib/update-flow';

const note = (id: string, featured = false): ShownNote => ({
  id, date: '2026-09-30', kind: 'feature', icon: '⭐', title: id, body: `${id} body`, featured, edited: false,
});
const release = (app_version: string, notes: ShownNote[], id = 1): WhatsNewRelease => ({
  id, released_at: '2026-09-30T02:00:00Z', app_version, notes,
});

describe('updateContent', () => {
  it('takes only the releases newer than the running bundle, newest first', () => {
    const c = updateContent([
      release('2.41.45', [note('old', true)], 1),
      release('2.41.46', [note('a', true), note('b')], 2),
      release('2.41.47', [note('c', true)], 3),
    ], '2.41.45');
    expect(c.version).toBe('2.41.47');
    expect(c.starred.map(n => n.id)).toEqual(['c', 'a']);
    expect(c.rest.map(n => n.id)).toEqual(['b']);
  });

  it('stars at most three and moves the rest of the featured into the list', () => {
    const c = updateContent([release('3.0.0', ['a', 'b', 'c', 'd'].map(id => note(id, true)).concat(note('e')))], '2.0.0');
    expect(c.starred.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(c.rest.map(n => n.id)).toEqual(['d', 'e']);
  });

  it('compares versions numerically, not as strings', () => {
    expect(updateContent([release('2.41.100', [note('x')])], '2.41.99').version).toBe('2.41.100');
    expect(updateContent([release('2.41.9', [note('x')])], '2.41.10').version).toBeNull();
  });

  it('with no answer from the server there is only the version-less button', () => {
    expect(updateContent(null, '2.41.45')).toEqual({ version: null, starred: [], rest: [] });
  });

  it('marks the starred rows seen for the digest sheet, by its own slugs', () => {
    const c = updateContent([release('9.9.9', [note('a', true), note('b')])], '1.0.0');
    expect(seenSlugs(c)).toEqual(['release:a']);
  });
});

describe('onlyTheWorkerIsOld', () => {
  it('the first open after a deploy already runs the new bundle: nothing to ask', () => {
    expect(onlyTheWorkerIsOld([release('2.41.48', []), release('2.41.47', [note('a', true)])], '2.41.48')).toBe(true);
    expect(onlyTheWorkerIsOld([], '2.41.48')).toBe(true);
  });

  it('asks when the server knows a newer release, or did not answer', () => {
    expect(onlyTheWorkerIsOld([release('2.41.49', [])], '2.41.48')).toBe(false);
    expect(onlyTheWorkerIsOld(null, '2.41.48')).toBe(false);
  });

  it('the prompt takes that swap the quiet way', () => {
    const src = readFileSync(join(__dirname, '../components/UpdatePrompt.tsx'), 'utf8');
    expect(src).toMatch(/if \(onlyTheWorkerIsOld\(releases, APP_VERSION\)\) \{\s*quiet = true;\s*tryApply\(\);/);
    expect(src).toMatch(/if \(superRef\.current && !quiet\) \{ void ask\(\); return; \}/);
  });
});

describe('the note left across the reload', () => {
  const now = 1_000_000;

  it('round-trips', () => {
    const raw = writeUpdatingNote('2.41.45', STAGE.handover, now);
    expect(readUpdatingNote(raw, now + 900)).toEqual({ from: '2.41.45', progress: STAGE.handover, at: now });
  });

  it('is ignored when stale, garbled or missing', () => {
    expect(readUpdatingNote(writeUpdatingNote('1', 0.7, now), now + UPDATING_TTL_MS + 1)).toBeNull();
    expect(readUpdatingNote('{nope', now)).toBeNull();
    expect(readUpdatingNote('{"from":1}', now)).toBeNull();
    expect(readUpdatingNote(null, now)).toBeNull();
  });

  it('never claims more than the handover: the rest is the new bundle to finish', () => {
    expect(readUpdatingNote(writeUpdatingNote('1', 5, now), now)?.progress).toBe(STAGE.handover);
  });

  it('says "updated" only when the reload really landed on another build', () => {
    const n = { from: '2.41.45', progress: 0.7, at: now };
    expect(landedOnNewBuild(n, '2.41.46')).toBe(true);
    expect(landedOnNewBuild(n, '2.41.45')).toBe(false);
  });

  it('the boot script reads the same key and cannot throw', () => {
    expect(UPDATE_BOOT_SCRIPT).toContain(JSON.stringify(UPDATING_KEY));
    expect(UPDATE_BOOT_SCRIPT.startsWith('try{')).toBe(true);
  });
});

describe('isMidTyping', () => {
  it('waits for text someone has started', () => {
    expect(isMidTyping({ tagName: 'TEXTAREA', value: 'half a sen' })).toBe(true);
    expect(isMidTyping({ tagName: 'INPUT', type: 'text', value: 'x' })).toBe(true);
    expect(isMidTyping({ tagName: 'DIV', isContentEditable: true, textContent: 'hi' })).toBe(true);
  });

  it('does not wait for an empty field, a checkbox, or nothing focused', () => {
    expect(isMidTyping({ tagName: 'TEXTAREA', value: '  ' })).toBe(false);
    expect(isMidTyping({ tagName: 'INPUT', type: 'checkbox', value: 'on' })).toBe(false);
    expect(isMidTyping({ tagName: 'BUTTON' })).toBe(false);
    expect(isMidTyping(null)).toBe(false);
  });
});

describe('the sheet cannot be dismissed', () => {
  // Code only: the file's comments explain what is absent, by name.
  const src = readFileSync(join(__dirname, '../components/update/UpdateSheet.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('is not the vaul drawer, which closes on swipe, Escape, backdrop and back', () => {
    expect(src).not.toMatch(/from ['"]@\/components\/ui\/Sheet|from ['"]vaul|useBackDismiss/);
  });

  it('has no way out but the button', () => {
    expect(src).not.toMatch(/onOpenChange|onClose|later/i);
  });
});
