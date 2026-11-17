import { describe, expect, it } from 'vitest';
import { mayOpenControlRoom } from './staff-pages';

describe('mayOpenControlRoom', () => {
  it('is undecided until /api/auth/me answers', () => {
    expect(mayOpenControlRoom(undefined)).toBeUndefined();
    expect(mayOpenControlRoom(null)).toBeUndefined();
  });

  it('opens for an admin account whatever view it is in (primary coach, admin in roles)', () => {
    expect(mayOpenControlRoom({ role: 'coach', roles: ['coach', 'admin'] })).toBe(true);
    expect(mayOpenControlRoom({ role: 'admin', roles: ['admin', 'coach'] })).toBe(true);
    expect(mayOpenControlRoom({ role: 'runner', isSuper: true })).toBe(true);
  });

  it('stays closed for non-admins', () => {
    expect(mayOpenControlRoom({ role: 'coach', roles: ['coach'] })).toBe(false);
    expect(mayOpenControlRoom({ role: 'runner' })).toBe(false);
  });
});
