import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, relative, sep } from 'path';
import allowlist from './fixtures/hebrew-literal-allowlist.json';

/**
 * User-facing strings belong in messages/he.json + en.json. This fails when a
 * component or page outside the allowlist carries a Hebrew literal (comments do
 * not count), and when an allowlisted file has been cleaned but is still listed —
 * so the list can only shrink. To migrate a file: move its strings to messages/,
 * then delete its line from fixtures/hebrew-literal-allowlist.json.
 *
 * Some files stay on the list on purpose (e.g. /open and /register: reached from
 * Hebrew staff emails with no locale switcher). Key parity between the two
 * message files is pinned separately in messagesLocaleParity.test.ts.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url));
const ROOTS = ['components', 'app'];
const HEBREW = /[֐-׿]/;

export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'api' ? [] : files(p);
    return /\.tsx$/.test(e.name) ? [relative(SRC, p).split(sep).join('/')] : [];
  });
}

const all = ROOTS.flatMap((r) => files(join(SRC, r)));
const withHebrew = new Set(all.filter((f) => HEBREW.test(stripComments(readFileSync(join(SRC, f), 'utf8')))));
const allowed = new Set(allowlist as string[]);

describe('no hardcoded Hebrew in components and pages', () => {
  it('ignores comments but not strings or JSX text', () => {
    expect(HEBREW.test(stripComments('// שלום\n/* עולם */\nconst a = 1;'))).toBe(false);
    expect(HEBREW.test(stripComments("const a = 'שלום';"))).toBe(true);
    expect(HEBREW.test(stripComments('<p>שלום</p>'))).toBe(true);
    expect(HEBREW.test(stripComments("const u = 'https://x.y/שלום';"))).toBe(true);
  });

  it('no file outside the allowlist has a Hebrew literal', () => {
    expect([...withHebrew].filter((f) => !allowed.has(f)).sort()).toEqual([]);
  });

  it('the allowlist only lists files that still need it', () => {
    expect([...allowed].filter((f) => !withHebrew.has(f)).sort()).toEqual([]);
  });
});
