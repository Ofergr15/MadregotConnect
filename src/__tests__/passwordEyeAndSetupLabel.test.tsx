import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import { PasswordInput, revealStep } from '@/components/ui/PasswordInput';
import { optionalSetupLeft, setupLine } from '@/lib/admin/people';

const render = (locale: 'he' | 'en', el: React.ReactElement) =>
  renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale === 'he' ? he : en}>{el}</NextIntlClientProvider>);

describe('PasswordInput', () => {
  it('starts hidden, with an accessible name on the eye, in he and en', () => {
    const h = render('he', <PasswordInput id="pw" name="password" autoComplete="current-password" />);
    expect(h).toContain('type="password"');
    expect(h).toContain('aria-label="הצגת הסיסמה"');
    expect(h).toContain('aria-pressed="false"');
    expect(h).toContain('autoComplete="current-password"');
    expect(h).toContain('name="password"');
    expect(h).toMatch(/min-h-\[44px\][^"]*min-w-\[44px\]/);
    expect(h).toContain('end-0'); // logical side: left in RTL, right in LTR
    expect(render('en', <PasswordInput id="pw" />)).toContain('aria-label="Show password"');
    expect(en.common.hidePassword).toBe('Hide password');
    expect(he.common.hidePassword).toBe('הסתרת הסיסמה');
  });
  it('has no way to pre-fill a stored password', () => {
    const src = readFileSync(path.join(__dirname, '../components/ui/PasswordInput.tsx'), 'utf8');
    expect(src).not.toMatch(/defaultVisible|storedPassword|initialVisible/);
  });
  it('toggles, and resets to hidden on blur and submit', () => {
    expect(revealStep(false, 'toggle')).toBe(true);
    expect(revealStep(true, 'toggle')).toBe(false);
    expect(revealStep(true, 'blur')).toBe(false);
    expect(revealStep(true, 'submit')).toBe(false);
  });
});

describe('every password field uses PasswordInput', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p); }
      else if (/\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk(path.join(__dirname, '..'));
  it('no raw type="password" outside the component', () => {
    const offenders = files.filter(f => !f.endsWith('PasswordInput.tsx'))
      .filter(f => /type=["'{][^>\n]*password/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('People sheet setup line', () => {
  const tasks = (open: string[]) => ['watch', 'photo', 'personalInfo', 'sizes', 'notifications']
    .map(key => ({ key: key as never, done: !open.includes(key) }));
  it('names only optional steps, never the watch', () => {
    expect(optionalSetupLeft(tasks(['watch', 'notifications', 'photo']))).toEqual(['photo', 'notifications']);
  });
  it('reads as an optional next step, not a failure', () => {
    expect(setupLine({ setupDone: false, setupLeft: ['notifications'] })).toEqual({ kind: 'optional', keys: ['notifications'] });
    expect(he.people.setupOptional).toBe('אפשר להשלים: {items}');
    expect(JSON.stringify(he.people)).not.toContain('לא הושלמה');
  });
  it('is hidden when nothing optional is left, even without the celebration stamp', () => {
    expect(setupLine({ setupDone: false, setupLeft: [] })).toEqual({ kind: 'done' });
    expect(setupLine({ setupDone: true, setupLeft: ['photo'] })).toEqual({ kind: 'done' });
  });
});
