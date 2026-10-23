import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAdminHome, ADMIN_HOME_ORDER, ALL_NAV_ITEMS } from '@/lib/nav-items';

/**
 * The admin's new navigation (2026-10-20): Ofer — "make sure everything stays
 * connected". Every door on the new screens must open a page that exists, and
 * every page that left the menu must still be reachable at its link.
 */
const root = join(__dirname, '..', '..');
const APP = join(root, 'src/app/(app)');
const FILES = [
  'src/components/home/NewsHome.tsx',
  'src/components/admin/AdminManage.tsx',
  'src/lib/admin/manage-groups.ts',
  'src/app/(app)/dashboard/training/page.tsx',
  'src/app/(app)/dashboard/people/page.tsx',
];
const pageExists = (href: string) => {
  const path = href.split(/[?#]/)[0].replace(/^\//, '');
  return existsSync(join(APP, path, 'page.tsx')) || existsSync(join(root, 'src/app', path, 'page.tsx'));
};

describe('the admin navigation stays connected', () => {
  for (const f of FILES) {
    it(`every link in ${f.split('/').pop()} opens a real page`, () => {
      const src = readFileSync(join(root, f), 'utf8');
      const hrefs = [...src.matchAll(/['"`](\/dashboard\/[a-z0-9\-/]+(?:\?[^'"`]*)?)['"`]/g)].map((m) => m[1]).filter((h) => !h.includes('${'));
      expect(hrefs.length).toBeGreaterThan(0);
      const missing = hrefs.filter((h) => !pageExists(h));
      expect(missing, `links to pages that don't exist: ${missing.join(', ')}`).toEqual([]);
    });
  }
  it('the pages that left the menu still exist at their link', () => {
    for (const h of ['/dashboard/athletes', '/dashboard/entry-queue', '/dashboard/calendar', '/dashboard/activities', '/dashboard/numbers', '/dashboard/control-room', '/dashboard/settings'])
      expect(pageExists(h), h).toBe(true);
  });
  it('the admin bar is six tabs, the numbers second, each a nav item', () => {
    expect(ADMIN_HOME_ORDER).toHaveLength(6);
    expect(ADMIN_HOME_ORDER[1]).toBe('numbers');
    for (const t of ADMIN_HOME_ORDER.filter((x) => x !== 'dashboard')) expect(ALL_NAV_ITEMS.some((i) => i.tab === t) || t === 'coach-tools' || t === 'numbers', t).toBe(true);
  });
  it('the admin bar is for the admin home only', () => {
    expect(isAdminHome({ effectiveRole: 'admin', isAthlete: false })).toBe(true);
    expect(isAdminHome({ effectiveRole: 'admin', isAthlete: true, isOperator: true })).toBe(true);
    expect(isAdminHome({ effectiveRole: 'admin', isAthlete: true })).toBe(false);
    expect(isAdminHome({ effectiveRole: 'coach', isAthlete: false })).toBe(false);
  });
});
