import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// Every <PasswordInput> in the app, with what a password manager must see on it. A Garmin
// field must never be offered (or saved as) the Madregot account password, so it is
// autoComplete="off" with its own name; the two Madregot sign-ins stay current-password.
// 2026-11-18: the join form's Garmin field was filled with the Madregot login.

const SRC = path.join(__dirname, '..');
const EXPECTED: Record<string, { kind: 'garmin' | 'login'; autoComplete: string; name: string | null }> = {
  'app/page.tsx': { kind: 'login', autoComplete: 'current-password', name: null },
  'app/admin/login/page.tsx': { kind: 'login', autoComplete: 'current-password', name: null },
  'app/(app)/dashboard/profile/page.tsx': { kind: 'garmin', autoComplete: 'off', name: 'garmin-password' },
  'app/join/academy/[token]/page.tsx': { kind: 'garmin', autoComplete: 'off', name: 'garmin-password' },
  'app/join/onboard/page.tsx': { kind: 'garmin', autoComplete: 'off', name: 'garmin-password' },
  'app/join/[token]/page.tsx': { kind: 'garmin', autoComplete: 'off', name: 'garmin-password' },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Each <PasswordInput ...> opening tag's attributes, up to its closing `/>`. */
function passwordTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<PasswordInput\b([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) tags.push(m[1]);
  return tags;
}
const attr = (tag: string, a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(tag)?.[1] ?? null;

const found = walk(path.join(SRC, 'app')).flatMap(f => passwordTags(readFileSync(f, 'utf8'))
  .map(tag => ({ file: path.relative(SRC, f).split(path.sep).join('/'), tag })));

describe('password fields and autofill', () => {
  it('the list of password fields is exactly the expected six', () => {
    expect(found.map(f => f.file).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s', (file, want) => {
    const { tag } = found.find(f => f.file === file)!;
    const ac = attr(tag, 'autoComplete');
    expect(ac).toBe(want.autoComplete);
    if (want.name) expect(attr(tag, 'name')).toBe(want.name);
    if (want.kind === 'garmin') {
      expect(['current-password', 'new-password', '', null]).not.toContain(ac);
      expect(attr(tag, 'name')).not.toBe('password');
    }
  });

  it('the Garmin email next to each Garmin password is not the Madregot username', () => {
    for (const [file, want] of Object.entries(EXPECTED)) {
      if (want.kind !== 'garmin') continue;
      const src = readFileSync(path.join(SRC, file), 'utf8');
      const at = src.indexOf('<PasswordInput');
      const before = src.slice(Math.max(0, at - 1200), at);
      const emailTag = before.slice(before.lastIndexOf('type="email"') - 200);
      expect(emailTag, file).toContain('name="garmin-email"');
      expect(emailTag, file).toContain('autoComplete="off"');
      expect(emailTag, file).not.toContain('autoComplete="username"');
    }
  });
});
