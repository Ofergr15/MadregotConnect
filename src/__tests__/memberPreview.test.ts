import { describe, expect, it } from 'vitest';
import { viewerForPreview } from '@/lib/auth/member-preview';

// `?as=member` ("how teammates see me"): only ever REDUCES, only for self or staff.
const ME = 'me';
const q = (s: string) => new URLSearchParams(s);
const runner = { email: 'r@x', athleteId: ME, isStaff: false, isSuperUser: false };

describe('viewerForPreview', () => {
  it('no `as` → the caller, unchanged', () => {
    const r = viewerForPreview(runner, ME, q(''));
    expect(r.viewer).toEqual({ athleteId: ME, isStaff: false, isSuperUser: false, preview: false });
  });

  it('self → a plain member who is not the owner', () => {
    expect(viewerForPreview(runner, ME, q('as=member')).viewer)
      .toEqual({ athleteId: null, isStaff: false, isSuperUser: false, preview: true });
  });

  it('staff may preview anyone, and lose staff in the preview', () => {
    for (const c of [{ ...runner, athleteId: 'coach', isStaff: true }, { ...runner, athleteId: null, isSuperUser: true }]) {
      expect(viewerForPreview(c, 'other', q('as=member')).viewer)
        .toMatchObject({ athleteId: null, isStaff: false, isSuperUser: false });
    }
  });

  it('400 for a runner previewing someone else, a missing target, an unknown value, or no verified identity', () => {
    const cases: Array<[typeof runner | { email: string; athleteId: null; isStaff: boolean }, string | null, string]> = [
      [runner, 'other', 'as=member'],
      [runner, null, 'as=member'],
      [runner, ME, 'as=coach'],
      [runner, ME, 'as=staff'],
      [{ email: '', athleteId: null, isStaff: false }, ME, 'as=member'],
    ];
    for (const [c, t, s] of cases) {
      const r = viewerForPreview(c, t, q(s));
      expect(r.viewer).toBeNull();
      expect(r.error!.status).toBe(400);
    }
  });

  it('can never return more rights than the caller had', () => {
    for (const c of [runner, { ...runner, isStaff: true }, { ...runner, isSuperUser: true }]) {
      const v = viewerForPreview(c, ME, q('as=member')).viewer!;
      expect(v.isStaff && !c.isStaff).toBe(false);
      expect(v.isSuperUser && !c.isSuperUser).toBe(false);
      expect(v.athleteId).toBeNull();
    }
  });
});
