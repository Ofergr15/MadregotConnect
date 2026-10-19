import { describe, expect, it } from 'vitest';
import { isStaffOnlyPath, mayOpenStaffPage } from '@/lib/auth/staff-pages';

/**
 * The lock a plain member sees on a staff screen (lib/auth/staff-pages.ts). The case
 * that must never regress: anyone who works on these screens today keeps them.
 */
describe('staff-only screens', () => {
  it('knows the staff screens and their sub-pages, and nothing else', () => {
    expect(isStaffOnlyPath('/dashboard/people')).toBe(true);
    expect(isStaffOnlyPath('/dashboard/plan/new')).toBe(true);
    expect(isStaffOnlyPath('/dashboard/athletes/abc')).toBe(true);
    // A runner's own screens, including settings (off in the menu matrix, but theirs).
    for (const p of ['/feed', '/dashboard/settings', '/dashboard/review', '/dashboard/program', '/dashboard/packs/x', '/dashboard/peoplex']) {
      expect(isStaffOnlyPath(p), p).toBe(false);
    }
  });

  it('keeps every staff role, the super user and approvers (entry queue) in', () => {
    for (const role of ['admin', 'coach', 'academy_coach']) expect(mayOpenStaffPage({ role }, '/dashboard/people'), role).toBe(true);
    expect(mayOpenStaffPage({ role: 'academy_coach', roles: ['academy_coach', 'academy_manager'] }, '/dashboard/groups')).toBe(true);
    expect(mayOpenStaffPage({ role: 'runner', roles: ['runner', 'coach'] }, '/dashboard/roles')).toBe(true);
    expect(mayOpenStaffPage({ role: 'runner', isSuper: true }, '/dashboard/move')).toBe(true);
    expect(mayOpenStaffPage({ role: 'core_runner', canApprove: true }, '/dashboard/entry-queue')).toBe(true);
  });

  it('locks plain members out', () => {
    for (const role of ['runner', 'core_runner', 'viewer', 'academy_user']) expect(mayOpenStaffPage({ role }, '/dashboard/people'), role).toBe(false);
    // Approving members opens the entry queue only.
    expect(mayOpenStaffPage({ role: 'runner', canApprove: true }, '/dashboard/people')).toBe(false);
  });

  it('never locks while the account is still unknown', () => {
    expect(mayOpenStaffPage(undefined, '/dashboard/people')).toBe(true);
  });
});
