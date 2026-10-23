import { describe, expect, it } from 'vitest';
import { levelsFor, roleLevels, seesAny } from '@/lib/access/grants';
import { mayOpenStaffPage } from '@/lib/auth/staff-pages';

/** ניהול ← הרשאות (Ofer 10-23): a Content level per part, per person, on top of the role. */
describe('content levels', () => {
  it('staff publish every part, as before; a runner nothing', () => {
    expect(Object.values(roleLevels({ role: 'coach' }))).toEqual([3, 3, 3, 3, 3, 3]);
    expect(seesAny(roleLevels({ role: 'runner' }))).toBe(false);
  });
  it('a grant only raises', () => {
    const l = levelsFor({ role: 'runner' }, { content: { share: 3, photos: 1 } });
    expect([l.share, l.photos, l.messages]).toEqual([3, 1, 0]);
    expect(levelsFor({ role: 'admin' }, { content: { photos: 1 } }).photos).toBe(3);
  });
  it('"for approval" is its own level (stage 2)', () => {
    expect(levelsFor({ role: 'runner' }, { content: { cheers: 2 } }).cheers).toBe(2);
  });
});

describe('the Content page opens for a member with a part', () => {
  it('only Content, not the other staff screens', () => {
    const guy = { role: 'runner', contentLevels: { share: 3, photos: 3 } };
    expect(mayOpenStaffPage(guy, '/dashboard/content/photos')).toBe(true);
    expect(mayOpenStaffPage(guy, '/dashboard/people')).toBe(false);
    expect(mayOpenStaffPage({ role: 'runner', contentLevels: { share: 0 } }, '/dashboard/content')).toBe(false);
  });
});
