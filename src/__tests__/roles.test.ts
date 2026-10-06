import { describe, expect, it } from 'vitest';
import { grantedRoles, hasRole, heldRoles, holdsStaffRole, rolesToColumns } from '@/lib/auth/roles';
import { defaultViewFor, homeFor, navRoleFor, resolveView, rolePreview, viewsFor } from '@/lib/role-views';
import { isAcademyManager, canAdmitToAcademy } from '@/lib/academy/pairing-server';

describe('heldRoles', () => {
  it('puts the primary first and dedupes', () => {
    expect(heldRoles('coach', ['academy_coach', 'coach'])).toEqual(['coach', 'academy_coach']);
  });
  it('reads a missing or non-array column as none', () => {
    expect(heldRoles('admin', undefined)).toEqual(['admin']);
    expect(heldRoles(null, null)).toEqual(['runner']);
    expect(heldRoles('runner', 'coach')).toEqual(['runner']);
  });
});

describe('hasRole / holdsStaffRole', () => {
  it('checks primary and extras', () => {
    expect(hasRole({ role: 'runner', roles: ['runner', 'academy_manager'] }, 'academy_manager')).toBe(true);
    expect(hasRole({ role: 'admin' }, 'admin')).toBe(true);
    expect(hasRole({ role: 'coach', roles: ['coach'] }, 'admin')).toBe(false);
    expect(hasRole(null, 'admin')).toBe(false);
  });
  it('counts the manager as staff', () => {
    expect(holdsStaffRole(['runner', 'academy_manager'])).toBe(true);
    expect(holdsStaffRole(['core_runner'])).toBe(false);
  });
});

describe('grantedRoles', () => {
  it('lists only grantable roles in canonical order', () => {
    expect(grantedRoles('core_runner', ['admin', 'academy_coach'])).toEqual(['academy_coach', 'admin']);
    expect(grantedRoles('runner', [])).toEqual([]);
  });
});

describe('rolesToColumns', () => {
  it('makes the highest role primary', () => {
    expect(rolesToColumns(['academy_coach', 'coach', 'admin'], 'runner')).toEqual({
      role: 'admin',
      extra_roles: ['coach', 'academy_coach'],
    });
  });
  it('never makes academy_manager primary and keeps the member role', () => {
    expect(rolesToColumns(['academy_manager'], 'core_runner')).toEqual({ role: 'core_runner', extra_roles: ['academy_manager'] });
  });
  it('drops a switched-off staff primary to runner', () => {
    expect(rolesToColumns([], 'coach')).toEqual({ role: 'runner', extra_roles: [] });
  });
});

describe('isAcademyManager / canAdmitToAcademy', () => {
  it('lets an academy_manager extra role manage', () => {
    expect(isAcademyManager({ isSuperUser: false, role: 'runner', roles: ['runner', 'academy_manager'] })).toBe(true);
    expect(isAcademyManager({ isSuperUser: false, role: 'academy_coach', roles: ['academy_coach'] })).toBe(false);
    expect(isAcademyManager({ isSuperUser: true, role: 'runner' })).toBe(true);
  });
  it('lets an extra academy_coach admit', () => {
    expect(canAdmitToAcademy({ isSuperUser: false, role: 'coach', roles: ['coach', 'academy_coach'] })).toBe(false);
  });
});

describe('views', () => {
  it('offers nothing to switch for a plain runner', () => {
    expect(viewsFor(['runner'])).toEqual(['runner']);
    expect(rolePreview(['runner'], 'runner').chip).toBe(false);
  });
  it('lists held views in order', () => {
    expect(viewsFor(['admin', 'academy_manager', 'coach'])).toEqual(['runner', 'coach', 'manager', 'admin']);
    expect(viewsFor(['runner'], true)).toEqual(['runner', 'admin']);
  });
  it('previews the other views, not the shown one', () => {
    expect(rolePreview(['coach'], 'coach')).toEqual({ chip: true, text: 'ויוכל לעבור לתצוגת רץ' });
    expect(rolePreview(['admin', 'academy_manager'], 'admin').text).toBe('ויוכל לעבור לתצוגת רץ / מנהל אקדמיה');
  });
  it('defaults to the primary role view', () => {
    expect(defaultViewFor('admin')).toBe('admin');
    expect(defaultViewFor('academy_coach')).toBe('coach');
    expect(defaultViewFor('core_runner')).toBe('runner');
    expect(defaultViewFor('runner', true)).toBe('admin');
  });
  it('maps views to nav roles', () => {
    expect(navRoleFor('manager', ['runner', 'academy_manager'], 'runner')).toBe('academy_coach');
    expect(navRoleFor('manager', ['admin', 'academy_manager'], 'admin')).toBe('admin');
    expect(navRoleFor('coach', ['admin', 'coach'], 'admin')).toBe('coach');
    expect(navRoleFor('coach', ['academy_coach'], 'academy_coach')).toBe('academy_coach');
    expect(navRoleFor('runner', ['admin'], 'admin')).toBe('runner');
    expect(navRoleFor('runner', ['core_runner', 'academy_manager'], 'core_runner')).toBe('core_runner');
  });
  it('lands each view on its home', () => {
    expect(homeFor('manager', [])).toBe('/dashboard/academy');
    expect(homeFor('coach', ['academy_coach'])).toBe('/dashboard/academy');
    expect(homeFor('coach', ['coach'])).toBe('/dashboard/coach-tools');
    expect(homeFor('runner', ['coach'])).toBe('/dashboard');
  });
  it('falls back when the stored view is no longer held', () => {
    expect(resolveView('admin', ['runner', 'coach'], 'coach')).toBe('coach');
    expect(resolveView('runner', ['runner', 'coach'], 'coach')).toBe('runner');
    expect(resolveView(null, ['runner'], 'admin')).toBe('runner');
  });
});
